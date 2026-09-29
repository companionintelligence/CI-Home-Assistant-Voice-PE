"""
After an error event the bridge ends the exchange by closing the connection.

Home Assistant releases from 2025.10 through 2026.7 (the ones checked) never look at
an error event in their Wyoming STT and TTS clients: those read until a transcript,
audio-stop or end of stream, with no timeout of their own, so a bridge that sends
Error and then goes quiet hangs the whole Assist pipeline. From 2026.8 the clients
read the error and stop, so the close is harmless there. The tests run the read loops
of both shapes (see harness.HA_SHAPES) and hold the bridge to the one signal every
release reacts to: after an error event, the connection ends.
"""
import pytest
from wyoming.error import Error
from wyoming.event import Event
from wyoming.info import Describe, Info
from wyoming.tts import Synthesize

from .harness import (
    HA_SHAPES,
    HUNG,
    describe_read,
    ha_conversation,
    ha_stt,
    ha_tts,
    read,
    send_utterance,
)

UPSTREAM_FAILURES = [
    pytest.param(401, id="http-401"),
    pytest.param(403, id="http-403"),
    pytest.param(429, id="http-429"),
    pytest.param(500, id="http-500"),
    pytest.param(502, id="http-502"),
    pytest.param(503, id="http-503"),
    pytest.param("invalid-json", id="invalid-json"),
    pytest.param("drop", id="dropped-mid-body"),
    pytest.param("hang", id="timeout"),
]

# 0.3 s is long enough for a local fake and keeps the timeout cases quick.
FAST_TIMEOUT = {"CI_REQUEST_TIMEOUT_S": "0.3"}


@pytest.mark.parametrize("failure", UPSTREAM_FAILURES)
async def test_stt_error_is_followed_by_close(bridge_stack, failure):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["stt"] = failure
    async with bridge.connect() as client:
        await send_utterance(client)
        first = await read(client)
        assert isinstance(first, Event) and Error.is_type(first.type), describe_read(first)
        assert Error.from_event(first).code == "stt-error"
        after = await read(client)
        assert after is None, f"expected end of stream after the error, got {describe_read(after)}"


@pytest.mark.parametrize("failure", UPSTREAM_FAILURES + [pytest.param("plain-text", id="not-wav")])
async def test_tts_error_is_followed_by_close(bridge_stack, failure):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["speech"] = failure
    async with bridge.connect() as client:
        await client.write_event(Synthesize(text="hello").event())
        first = await read(client)
        assert isinstance(first, Event) and Error.is_type(first.type), describe_read(first)
        assert Error.from_event(first).code == "tts-error"
        after = await read(client)
        assert after is None, f"expected end of stream after the error, got {describe_read(after)}"


@HA_SHAPES
@pytest.mark.parametrize("failure", UPSTREAM_FAILURES)
async def test_home_assistant_stt_loop_finishes_when_transcription_fails(bridge_stack, failure, reads_errors):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["stt"] = failure
    # stt.py reports the request as failed, on the error event or on end of stream; it must not wait forever.
    assert await ha_stt(bridge.wyoming_port, reads_errors=reads_errors) == ("error", None)


@HA_SHAPES
@pytest.mark.parametrize("failure", UPSTREAM_FAILURES + [pytest.param("plain-text", id="not-wav")])
async def test_home_assistant_tts_loop_finishes_when_synthesis_fails(bridge_stack, failure, reads_errors):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["speech"] = failure
    # The older loops see end of stream (no audio); the newer ones raise on the error event.
    expected = ("error-event", None) if reads_errors else ("no-audio", None)
    assert await ha_tts(bridge.wyoming_port, reads_errors=reads_errors) == expected


@HA_SHAPES
async def test_home_assistant_loops_still_get_their_results(bridge, reads_errors):
    port = bridge.wyoming_port
    assert await ha_stt(port, reads_errors=reads_errors) == ("text", "turn on the kitchen lights")
    assert await ha_tts(port, reads_errors=reads_errors) == ("audio", 2400 * 2)
    assert await ha_conversation(port, reads_errors=reads_errors) == ("handled", "Answer 1.")


@HA_SHAPES
async def test_conversation_failure_is_still_answered_with_not_handled(bridge, reads_errors):
    # Not an Error event, and every release reads it, so this path is unchanged.
    bridge.fake.modes["responses"] = 502
    kind, text = await ha_conversation(bridge.wyoming_port, reads_errors=reads_errors)
    assert kind == "not-handled" and text


async def test_successful_exchanges_leave_the_connection_open(bridge):
    # Only errors end a connection. After a good transcript the client may go on.
    async with bridge.connect() as client:
        await send_utterance(client)
        transcript = await read(client)
        assert isinstance(transcript, Event) and transcript.type == "transcript"
        await client.write_event(Describe().event())
        info = await read(client)
        assert isinstance(info, Event) and Info.is_type(info.type), describe_read(info)

    async with bridge.connect() as client:
        await client.write_event(Synthesize(text="hello").event())
        while True:
            event = await read(client)
            assert isinstance(event, Event), describe_read(event)
            if event.type == "audio-stop":
                break
        await client.write_event(Describe().event())
        info = await read(client)
        assert info is not HUNG and isinstance(info, Event) and Info.is_type(info.type)
