"""
When ci-server cannot do what the bridge asked, the person at home hears one
sentence and the operator reads one log line. Both have to say what went wrong:
a wrong API key is not a dead server, a rate limit is not a timeout, and a
timeout is never an empty message.
"""
import logging

import pytest
from wyoming.error import Error
from wyoming.event import Event
from wyoming.handle import NotHandled
from wyoming.asr import Transcript
from wyoming.tts import Synthesize

from .harness import describe_read, read, send_utterance

# 0.3 s is long enough for a local fake and keeps the timeout cases quick.
FAST_TIMEOUT = {"CI_REQUEST_TIMEOUT_S": "0.3"}

RATE_LIMITED = (429, {"Retry-After": "2"})

# What the person hears, by cause. The wording may change; what has to hold is that
# each cause has words of its own, which the distinctness test below enforces.
CONVERSATION_CASES = [
    pytest.param(401, "API key", id="http-401"),
    pytest.param(403, "API key", id="http-403"),
    pytest.param(RATE_LIMITED, "busy", id="http-429-retry-after"),
    pytest.param(500, "could not reach", id="http-500"),
    pytest.param(502, "could not reach", id="http-502"),
    pytest.param(503, "could not reach", id="http-503"),
    pytest.param("drop", "could not reach", id="dropped-mid-body"),
    pytest.param("hang", "took too long", id="timeout"),
    pytest.param(404, "could not understand", id="http-404"),
    pytest.param("invalid-json", "could not understand", id="invalid-json"),
    pytest.param("json-list", "could not understand", id="json-list"),
    pytest.param("json-null", "could not understand", id="json-null"),
    pytest.param("plain-text", "could not understand", id="not-json"),
    pytest.param("empty", "could not understand", id="empty-reply"),
]


async def _spoken_reply(bridge) -> str:
    async with bridge.connect() as client:
        await client.write_event(Transcript(text="hello").event())
        event = await read(client)
    assert isinstance(event, Event) and NotHandled.is_type(event.type), describe_read(event)
    return NotHandled.from_event(event).text


@pytest.mark.parametrize("failure,expected", CONVERSATION_CASES)
async def test_conversation_failure_says_what_went_wrong(bridge_stack, failure, expected):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["responses"] = failure
    assert expected in await _spoken_reply(bridge)


async def test_conversation_failure_when_ci_server_is_down(bridge_stack):
    bridge = await bridge_stack(ci_url="http://127.0.0.1:1")
    assert "could not reach" in await _spoken_reply(bridge)


async def test_each_cause_is_spoken_differently(bridge_stack):
    spoken = {}
    for cause, failure in {
        "auth": 401,
        "rate limit": RATE_LIMITED,
        "timeout": "hang",
        "server error": 502,
        "bad answer": "invalid-json",
    }.items():
        bridge = await bridge_stack(env=FAST_TIMEOUT)
        bridge.fake.modes["responses"] = failure
        spoken[cause] = await _spoken_reply(bridge)
    down = await bridge_stack(ci_url="http://127.0.0.1:1")
    spoken["unreachable"] = await _spoken_reply(down)

    # A dead server and a server that errors are both "could not reach"; every other cause has its own words.
    assert spoken["server error"] == spoken["unreachable"]
    del spoken["server error"]
    assert len(set(spoken.values())) == len(spoken), spoken
    assert all(text.strip() for text in spoken.values())


# ------------------------------------------------------------ STT and TTS

STT_CAUSES = [
    pytest.param(401, "auth", "HTTP 401", id="http-401"),
    pytest.param(403, "auth", "HTTP 403", id="http-403"),
    pytest.param(RATE_LIMITED, "rate_limit", "HTTP 429", id="http-429"),
    pytest.param(502, "unreachable", "HTTP 502", id="http-502"),
    pytest.param("hang", "timeout", "timed out", id="timeout"),
    pytest.param("invalid-json", "bad_response", "not valid JSON", id="invalid-json"),
    pytest.param("json-list", "bad_response", "unexpected JSON", id="json-list"),
]


def _error_text(event) -> str:
    assert isinstance(event, Event) and Error.is_type(event.type), describe_read(event)
    return Error.from_event(event).text


def _assert_names_the_cause(text: str, cause: str, detail: str, what: str) -> None:
    assert text.startswith(what)
    assert cause in text and detail in text
    assert not text.rstrip().endswith(":"), "the message ends where the reason should start"
    assert text.count("failed") == 1, "the message repeats its own prefix"


@pytest.mark.parametrize("failure,cause,detail", STT_CAUSES)
async def test_transcription_error_names_the_cause(bridge_stack, caplog, failure, cause, detail):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["stt"] = failure
    caplog.set_level(logging.INFO)
    async with bridge.connect() as client:
        await send_utterance(client)
        text = _error_text(await read(client))
    _assert_names_the_cause(text, cause, detail, "Transcription failed")
    logged = [r.getMessage() for r in caplog.records if r.name == "voice-bridge.wyoming" and r.levelno >= logging.ERROR]
    assert logged and all(detail in line and not line.rstrip().endswith(":") for line in logged), logged


@pytest.mark.parametrize(
    "failure,cause,detail",
    STT_CAUSES[:5] + [pytest.param("plain-text", "bad_response", "not WAV", id="not-wav")],
)
async def test_synthesis_error_names_the_cause(bridge_stack, caplog, failure, cause, detail):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    bridge.fake.modes["speech"] = failure
    caplog.set_level(logging.INFO)
    async with bridge.connect() as client:
        await client.write_event(Synthesize(text="hello").event())
        text = _error_text(await read(client))
    _assert_names_the_cause(text, cause, detail, "Speech synthesis failed")
    logged = [r.getMessage() for r in caplog.records if r.name == "voice-bridge.wyoming" and r.levelno >= logging.ERROR]
    assert logged and all(detail in line and not line.rstrip().endswith(":") for line in logged), logged


async def test_a_timeout_message_says_how_long_the_bridge_waited(bridge_stack):
    bridge = await bridge_stack(env={"CI_REQUEST_TIMEOUT_S": "0.25"})
    bridge.fake.modes["stt"] = "hang"
    async with bridge.connect() as client:
        await send_utterance(client)
        text = _error_text(await read(client))
    assert "0.25s" in text


async def test_the_timeout_applies_to_every_call(bridge_stack):
    bridge = await bridge_stack(env=FAST_TIMEOUT)
    for route in ("stt", "responses", "speech"):
        bridge.fake.modes[route] = "hang"
    async with bridge.connect() as client:
        await send_utterance(client)
        assert "timed out" in _error_text(await read(client))
    async with bridge.connect() as client:
        await client.write_event(Synthesize(text="hello").event())
        assert "timed out" in _error_text(await read(client))
    assert "took too long" in await _spoken_reply(bridge)


async def test_a_refused_connection_is_reported_as_unreachable(bridge_stack):
    bridge = await bridge_stack(ci_url="http://127.0.0.1:1")
    async with bridge.connect() as client:
        await send_utterance(client)
        text = _error_text(await read(client))
    assert "unreachable" in text
    assert not text.rstrip().endswith(":")
