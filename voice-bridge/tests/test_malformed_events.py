"""
A client can send the bridge things it does not expect: an event with a field
missing, audio that is not a whole number of samples, a frame that is not a
Wyoming event at all. None of that may end a handler task with an exception
nobody retrieves (asyncio logs 'Task exception was never retrieved'). The bridge
answers with an error event and closes the connection, and keeps serving.

The `bridge_stack` fixture fails a test whose handler tasks died with an
exception, so every test here also checks that.
"""
import asyncio
import socket
import struct

import pytest
from wyoming.asr import Transcript
from wyoming.audio import AudioChunk, AudioStart
from wyoming.error import Error
from wyoming.event import Event, async_write_event
from wyoming.handle import Handled
from wyoming.info import Describe, Info

from .harness import describe_read, read, read_raw

CHUNK_16K = dict(rate=16000, width=2, channels=1)
START = AudioStart(**CHUNK_16K).event()

# Well-framed events whose content is wrong. Each list is sent in order.
BAD_EVENTS = {
    "chunk-without-format": [START, Event("audio-chunk", {}, payload=b"\x00\x00")],
    "chunk-not-whole-samples": [
        START,
        AudioChunk(rate=48000, width=2, channels=1, audio=b"\x00" * 7).event(),
    ],
    "chunk-width-0": [START, Event("audio-chunk", {**CHUNK_16K, "width": 0}, payload=b"\x00\x00")],
    "chunk-width-5": [START, Event("audio-chunk", {**CHUNK_16K, "width": 5}, payload=b"\x00" * 10)],
    "transcript-without-text": [Event("transcript", {})],
    "synthesize-without-text": [Event("synthesize", {})],
    "conversation-id-is-an-object": [
        Event("transcript", {"text": "hi", "context": {"conversation_id": {"a": 1}}}),
    ],
}

# Frames wyoming itself trips over while parsing, before any handler code runs.
BAD_FRAMES = {
    "no-type": b'{"data": {}}\n',
    "json-list": b"[]\n",
    "length-not-a-number": b'{"type": "audio-chunk", "data_length": "x"}\n',
}


async def _assert_still_serving(bridge) -> None:
    async with bridge.connect() as client:
        await client.write_event(Describe().event())
        info = await read(client)
    assert isinstance(info, Event) and Info.is_type(info.type), describe_read(info)


@pytest.mark.parametrize("name", BAD_EVENTS)
async def test_bad_event_gets_an_error_and_a_close(bridge, name):
    async with bridge.connect() as client:
        for event in BAD_EVENTS[name]:
            await client.write_event(event)
        answer = await read(client)
        assert isinstance(answer, Event) and Error.is_type(answer.type), describe_read(answer)
        assert Error.from_event(answer).code == "invalid-event"
        after = await read(client)
        assert after is None, f"expected end of stream after the error, got {describe_read(after)}"
    await _assert_still_serving(bridge)


@pytest.mark.parametrize("name", BAD_FRAMES)
async def test_unparseable_frame_gets_an_error_and_a_close(bridge, name):
    reader, writer = await bridge.open_raw()
    try:
        writer.write(BAD_FRAMES[name])
        await writer.drain()
        answer = await read_raw(reader)
        assert isinstance(answer, Event) and Error.is_type(answer.type), describe_read(answer)
        after = await read_raw(reader)
        assert after is None, f"expected end of stream after the error, got {describe_read(after)}"
    finally:
        writer.close()
    await _assert_still_serving(bridge)


async def test_line_noise_closes_the_connection_quietly(bridge):
    # wyoming reads a line that is not JSON as end of stream: no answer, no traceback.
    reader, writer = await bridge.open_raw()
    try:
        writer.write(b"GET / HTTP/1.1\r\nHost: bridge\r\n\r\n")
        await writer.drain()
        answer = await read_raw(reader)
        assert answer is None, describe_read(answer)
    finally:
        writer.close()
    await _assert_still_serving(bridge)


async def test_unknown_event_types_are_still_ignored(bridge):
    # Not malformed, only not ours: ignored as before, and the connection stays usable.
    async with bridge.connect() as client:
        await client.write_event(Event("ping", {"text": "are you there"}))
        await client.write_event(Describe().event())
        info = await read(client)
    assert isinstance(info, Event) and Info.is_type(info.type), describe_read(info)


async def test_audio_outside_a_recording_is_still_ignored(bridge):
    async with bridge.connect() as client:
        await client.write_event(Event("audio-chunk", {}, payload=b"\x00"))  # no audio-start first
        await client.write_event(Event("audio-stop", {}))
        await client.write_event(Describe().event())
        info = await read(client)
    assert isinstance(info, Event) and Info.is_type(info.type), describe_read(info)


async def _start_conversation_and_wait_for_the_llm(bridge):
    bridge.fake.modes["responses"] = "hang"
    reader, writer = await bridge.open_raw()
    await async_write_event(
        Transcript(text="What is on my calendar?", context={"conversation_id": "conv-1"}).event(), writer
    )
    for _ in range(100):
        if bridge.fake.calls["responses"]:
            return reader, writer
        await asyncio.sleep(0.02)
    raise AssertionError("the bridge never asked ci-server for an answer")


async def test_client_that_aborts_during_the_llm_call_leaves_no_history(bridge, loop_errors):
    # Home Assistant cancels the pipeline while the model is thinking and drops the connection.
    reader, writer = await _start_conversation_and_wait_for_the_llm(bridge)
    sock = writer.get_extra_info("socket")
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))  # close sends RST
    writer.transport.abort()

    bridge.fake.release()  # the model answers, into a connection that is gone
    await asyncio.sleep(0.3)
    await loop_errors.settle()

    assert not loop_errors.items, loop_errors.describe()
    # Nobody heard this answer, so the next question must not build on it.
    assert bridge.conversations.history("conv-1") == []
    await _assert_still_serving(bridge)


async def test_client_that_hangs_up_during_the_llm_call_leaves_no_traceback(bridge, loop_errors):
    reader, writer = await _start_conversation_and_wait_for_the_llm(bridge)
    writer.close()

    bridge.fake.release()
    await asyncio.sleep(0.3)
    await loop_errors.settle()

    assert not loop_errors.items, loop_errors.describe()
    await _assert_still_serving(bridge)


async def test_stopping_the_server_during_the_llm_call_leaves_no_traceback(bridge, loop_errors):
    # What SIGTERM does: wyoming closes every client, the in-flight request then finishes.
    reader, writer = await _start_conversation_and_wait_for_the_llm(bridge)
    await bridge.server.stop()

    bridge.fake.release()
    await asyncio.sleep(0.3)
    await loop_errors.settle()
    writer.close()

    assert not loop_errors.items, loop_errors.describe()
    assert bridge.conversations.history("conv-1") == []


async def test_answered_conversation_is_recorded(bridge):
    # The other half of the ordering change: a delivered answer still lands in the history.
    async with bridge.connect() as client:
        await client.write_event(Transcript(text="hello", context={"conversation_id": "c9"}).event())
        answer = await read(client)
    assert isinstance(answer, Event) and Handled.is_type(answer.type)
    assert bridge.conversations.history("c9") == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "Answer 1."},
    ]


async def test_conversation_without_an_id_gets_one_and_is_recorded(bridge):
    async with bridge.connect() as client:
        await client.write_event(Transcript(text="hello").event())
        answer = await read(client)
    assert isinstance(answer, Event) and Handled.is_type(answer.type)
    conversation_id = Handled.from_event(answer).context["conversation_id"]
    assert conversation_id and bridge.conversations.history(conversation_id)[-1]["content"] == "Answer 1."
