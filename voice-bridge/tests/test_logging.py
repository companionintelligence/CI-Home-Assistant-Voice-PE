"""
What people say to a voice assistant, and what it says back, is the most sensitive
thing this bridge sees, and `docker logs` is where it would end up. By default
neither goes into the logs; LOG_TRANSCRIPTS=true turns that on for troubleshooting.
The API key never goes into the logs either way.
"""
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from wyoming.asr import Transcript
from wyoming.error import Error
from wyoming.event import Event
from wyoming.info import Describe
from wyoming.tts import Synthesize

from .harness import API_KEY, read, send_utterance

BRIDGE_DIR = Path(__file__).resolve().parent.parent

SPOKEN_REQUEST = "What is on my calendar tonight?"
TRANSCRIBED = "turn on the kitchen lights"  # what the fake speech-to-text hears
REPLY = "Answer 1."  # what the fake language model says


async def _talk(bridge) -> list[Event]:
    """One speech-to-text request, a Describe, one conversation turn and one text-to-speech request."""
    events = []
    async with bridge.connect() as client:
        await send_utterance(client)
        events.append(await read(client))
    async with bridge.connect() as client:
        await client.write_event(Describe().event())
        events.append(await read(client))
    async with bridge.connect() as client:
        await client.write_event(Transcript(text=SPOKEN_REQUEST, context={"conversation_id": "c1"}).event())
        events.append(await read(client))
    async with bridge.connect() as client:
        await client.write_event(Synthesize(text="Lights on.").event())
        while True:
            event = await read(client)
            events.append(event)
            if not isinstance(event, Event) or event.type in ("audio-stop", "error"):
                break
    return events


def _log_text(caplog) -> str:
    return "\n".join(f"{r.name} {r.levelname} {r.getMessage()}" for r in caplog.records)


async def test_transcripts_and_replies_are_not_logged_by_default(bridge, caplog):
    caplog.set_level(logging.DEBUG)  # even the noisiest level must not carry them
    await _talk(bridge)
    text = _log_text(caplog)
    assert TRANSCRIBED not in text
    assert SPOKEN_REQUEST not in text
    assert REPLY not in text


async def test_failures_do_not_log_what_was_said(bridge, caplog):
    caplog.set_level(logging.DEBUG)
    bridge.fake.modes["responses"] = 502
    bridge.fake.modes["stt"] = 500
    await _talk(bridge)
    text = _log_text(caplog)
    assert "failed" in text  # the failures themselves are logged
    assert SPOKEN_REQUEST not in text


async def test_transcripts_and_replies_are_logged_when_opted_in(bridge_stack, caplog):
    bridge = await bridge_stack(env={"LOG_TRANSCRIPTS": "true"})
    caplog.set_level(logging.INFO)
    await _talk(bridge)
    text = _log_text(caplog)
    assert TRANSCRIBED in text
    assert REPLY in text


@pytest.mark.parametrize(
    "api_key",
    [
        pytest.param("wrong-secret-key-1234", id="rejected-key"),
        pytest.param("secret-part-one\nsecret-part-two", id="key-with-newline"),
        pytest.param(API_KEY, id="accepted-key"),
    ],
)
async def test_api_key_is_never_logged_or_sent_back(bridge_stack, caplog, api_key):
    bridge = await bridge_stack(env={"CI_SERVER_API_KEY": api_key})
    caplog.set_level(logging.DEBUG)
    events = await _talk(bridge)
    sent = "\n".join(str(e.data) for e in events if isinstance(e, Event))
    secrets = [api_key, *api_key.splitlines()]
    for secret in secrets:
        assert secret not in _log_text(caplog)
        assert secret not in sent
    # The rejected keys really did reach the failure paths this test is about.
    if api_key != API_KEY:
        assert any(isinstance(e, Event) and Error.is_type(e.type) for e in events)


# ------------------------------------------------------------------ DEBUG


def _root_level_after_importing_main(debug: str | None) -> int:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("DEBUG", None)
    if debug is not None:
        env["DEBUG"] = debug
    out = subprocess.run(
        [sys.executable, "-c", "import main, logging; print(logging.getLogger().level)"],
        cwd=BRIDGE_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return int(out.stdout.strip())


@pytest.mark.parametrize("debug", [None, "", "1", "true"])
def test_main_debug_flag_when_it_is_unambiguous(debug):
    expected = logging.DEBUG if debug in ("1", "true") else logging.INFO
    assert _root_level_after_importing_main(debug) == expected


# main.py is not part of src/, and until it reads DEBUG through src.config.debug_enabled()
# any non-empty string, "0" and "false" included, turns debug logging on. The marker
# switches itself off once main.py uses debug_enabled, so the test then guards the fix.
_MAIN_STILL_TESTS_DEBUG_FOR_TRUTHINESS = "debug_enabled" not in (BRIDGE_DIR / "main.py").read_text()


@pytest.mark.xfail(
    _MAIN_STILL_TESTS_DEBUG_FOR_TRUTHINESS,
    strict=True,
    reason=(
        "main.py still tests os.environ.get('DEBUG') for truthiness, so any non-empty string "
        "turns debug on. Switch it to src.config.debug_enabled()."
    ),
)
def test_main_does_not_turn_debug_on_for_zero_or_false():
    levels = {debug: _root_level_after_importing_main(debug) for debug in ("0", "false", "no", "off")}
    assert levels == {debug: logging.INFO for debug in levels}
