"""
What the bridge tells Home Assistant it offers when Home Assistant asks (Describe).

By default the answer is the same three programs every time, whatever ci-server has
configured, and ci-server is not called at all. That is what the bridge always did, and
what the README and the setup site describe.

Home Assistant picks the first speech-to-text and text-to-speech engine it finds as its
default, so advertising an engine ci-server cannot back sends a fresh install that has no
speech configured into an Assist pipeline that always fails. HIDE_UNCONFIGURED_SPEECH=true
is the opt-in for that: each Describe then uses what ci-server says (GET /v1/status) and
hides speech-to-text or text-to-speech only when the provider is "none". An answer it
cannot read, or no answer, hides nothing. Every /v1/status makes ci-server call its LLM
backend and Companion Memory, and the container healthcheck sends a Describe every 30
seconds, so the answer is kept for a while and one probe at a time asks for it.
"""
import asyncio
import logging
import time

import pytest
from wyoming.event import Event
from wyoming.info import Describe, Info

from src.client import ci_client
from src.wyoming.info import HANDLE_PROGRAM, STT_PROGRAM, TTS_PROGRAM, build_info

from .harness import describe_read, read

NONE = {"provider": "none", "model": None}
LOCAL = {"provider": "local", "model": "some-model"}
OPENAI = {"provider": "openai", "model": None}

HIDE = {"HIDE_UNCONFIGURED_SPEECH": "true"}

EVERYTHING = ([STT_PROGRAM], [TTS_PROGRAM], [HANDLE_PROGRAM])
NOTHING_BUT_CONVERSATION = ([], [], [HANDLE_PROGRAM])


def _status(stt, tts):
    return {"version": "test", "default_model": "ollama:test", "stt": stt, "tts": tts}


async def _describe(bridge) -> Event:
    async with bridge.connect() as client:
        await client.write_event(Describe().event())
        event = await read(client)
    assert isinstance(event, Event) and Info.is_type(event.type), describe_read(event)
    return event


def _programs(event: Event) -> tuple[list[str], list[str], list[str]]:
    info = Info.from_event(event)
    return (
        [p.name for p in info.asr],
        [p.name for p in info.tts],
        [p.name for p in info.handle],
    )


@pytest.fixture
async def hiding_bridge(bridge_stack):
    return await bridge_stack(env=HIDE)


async def _until_programs(bridge, expected, patience_s: float = 3.0) -> float:
    """Describe until the answer is `expected`; returns the slowest single Describe."""
    slowest = 0.0
    deadline = time.monotonic() + patience_s
    while True:
        started = time.monotonic()
        seen = _programs(await _describe(bridge))
        slowest = max(slowest, time.monotonic() - started)
        if seen == expected:
            return slowest
        assert time.monotonic() < deadline, f"still {seen} after {patience_s}s, wanted {expected}"
        await asyncio.sleep(0.05)


# ------------------------------------------------------------------ the default


async def test_by_default_describe_offers_everything_and_never_asks_ci_server(bridge):
    # ci-server says it has no speech at all, and the answer is still the usual three programs.
    bridge.fake.status_body = _status(NONE, NONE)
    for _ in range(3):
        event = await _describe(bridge)
        assert _programs(event) == EVERYTHING
        assert event.data == build_info(bridge.config).event().data
    assert bridge.fake.calls == {"stt": 0, "responses": 0, "speech": 0, "status": 0}


@pytest.mark.parametrize("value", ["false", "0", "no", "off", "", "nope"])
async def test_only_a_yes_like_word_turns_hiding_on(bridge_stack, value):
    bridge = await bridge_stack(env={"HIDE_UNCONFIGURED_SPEECH": value})
    bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(bridge)) == EVERYTHING
    assert bridge.fake.calls["status"] == 0


# ------------------------------------------------------------------ opted in


@pytest.mark.parametrize(
    "stt,tts,asr,speech",
    [
        pytest.param(NONE, NONE, [], [], id="neither-configured"),
        pytest.param(NONE, LOCAL, [], [TTS_PROGRAM], id="only-tts"),
        pytest.param(LOCAL, NONE, [STT_PROGRAM], [], id="only-stt"),
        pytest.param(LOCAL, LOCAL, [STT_PROGRAM], [TTS_PROGRAM], id="both-local"),
        pytest.param(OPENAI, OPENAI, [STT_PROGRAM], [TTS_PROGRAM], id="both-openai"),
    ],
)
async def test_info_offers_what_ci_server_reports(hiding_bridge, stt, tts, asr, speech):
    hiding_bridge.fake.status_body = _status(stt, tts)
    assert _programs(await _describe(hiding_bridge)) == (asr, speech, [HANDLE_PROGRAM])


async def test_configured_speech_gives_exactly_the_usual_info(hiding_bridge):
    hiding_bridge.fake.status_body = _status(LOCAL, OPENAI)
    event = await _describe(hiding_bridge)
    assert event.data == build_info(hiding_bridge.config).event().data


UNKNOWN_ANSWERS = [
    pytest.param(dict(mode=401), id="http-401"),
    pytest.param(dict(mode=404), id="http-404-older-ci-server"),
    pytest.param(dict(mode=500), id="http-500"),
    pytest.param(dict(mode=503), id="http-503-still-starting"),
    pytest.param(dict(mode="invalid-json"), id="invalid-json"),
    pytest.param(dict(mode="json-list"), id="json-list"),
    pytest.param(dict(mode="json-null"), id="json-null"),
    pytest.param(dict(mode="plain-text"), id="not-json"),
    pytest.param(dict(mode="drop"), id="dropped-mid-body"),
    pytest.param(dict(body={}), id="no-fields"),
    pytest.param(dict(body={"stt": None, "tts": None}), id="fields-are-null"),
    pytest.param(dict(body={"stt": "none", "tts": "none"}), id="fields-are-strings"),
    pytest.param(dict(body={"stt": {}, "tts": {}}), id="no-provider"),
    pytest.param(dict(body={"stt": {"provider": None}, "tts": {"provider": None}}), id="provider-is-null"),
    pytest.param(dict(body={"stt": {"provider": ""}, "tts": {"provider": ""}}), id="provider-is-empty"),
    pytest.param(dict(body={"stt": {"provider": "mystery"}, "tts": {"provider": "mystery"}}), id="new-provider-kind"),
    pytest.param(dict(body={"stt": ["none"], "tts": ["none"]}), id="fields-are-lists"),
]


@pytest.mark.parametrize("answer", UNKNOWN_ANSWERS)
async def test_an_answer_that_does_not_say_none_hides_nothing(hiding_bridge, answer):
    if "mode" in answer:
        hiding_bridge.fake.modes["status"] = answer["mode"]
    else:
        hiding_bridge.fake.status_body = answer["body"]
    event = await _describe(hiding_bridge)
    assert _programs(event) == EVERYTHING
    assert event.data == build_info(hiding_bridge.config).event().data


async def test_a_side_that_is_unknown_is_not_hidden_because_the_other_is_none(hiding_bridge):
    hiding_bridge.fake.status_body = {"stt": NONE}  # nothing said about tts
    assert _programs(await _describe(hiding_bridge)) == ([], [TTS_PROGRAM], [HANDLE_PROGRAM])


async def test_a_dead_ci_server_hides_nothing(bridge_stack):
    bridge = await bridge_stack(env=HIDE, ci_url="http://127.0.0.1:1")  # nothing listens on port 1
    assert _programs(await _describe(bridge)) == EVERYTHING


async def test_the_probe_carries_the_api_key(bridge_stack):
    # ci-server's /v1/status needs the master key. With a wrong key it answers 401, which
    # tells the bridge nothing, so nothing is hidden even though speech is not configured.
    wrong = await bridge_stack(env={**HIDE, "CI_SERVER_API_KEY": "not-the-key"})
    wrong.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(wrong)) == EVERYTHING

    right = await bridge_stack(env=HIDE)
    right.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(right)) == NOTHING_BUT_CONVERSATION


async def test_the_probe_only_touches_status(hiding_bridge):
    hiding_bridge.fake.status_body = _status(NONE, NONE)
    await _describe(hiding_bridge)
    assert hiding_bridge.fake.calls == {"stt": 0, "responses": 0, "speech": 0, "status": 1}


async def test_a_missing_speech_service_is_logged_once_not_on_every_probe(bridge_stack, caplog, monkeypatch):
    monkeypatch.setattr(ci_client, "STATUS_TTL_S", 0.1)
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.status_body = _status(NONE, LOCAL)
    caplog.set_level(logging.INFO)
    for _ in range(3):
        await _describe(bridge)
        await asyncio.sleep(0.15)  # past the lifetime of the answer, so the next Describe probes again
    assert bridge.fake.calls["status"] == 3
    notices = [r for r in caplog.records if r.name == "voice-bridge.ci-client" and "speech-to-text" in r.getMessage()]
    assert len(notices) == 1
    assert "text-to-speech" not in notices[0].getMessage()


# --------------------------------------------- a slow ci-server, and ci-server's load


async def test_a_slow_ci_server_cannot_make_describe_slower_than_home_assistant_waits(hiding_bridge):
    # Home Assistant gives Describe 1 s per attempt in the releases up to 2026.5 (5 s from
    # 2026.7; wyoming/data.py _INFO_TIMEOUT), then retries and eventually gives up on the
    # entry. The wait for the probe stays well inside the shorter limit.
    hiding_bridge.fake.modes["status"] = "hang"
    hiding_bridge.fake.status_body = _status(NONE, NONE)
    started = time.monotonic()
    event = await _describe(hiding_bridge)
    elapsed = time.monotonic() - started
    assert elapsed < 1.0, f"Describe took {elapsed:.2f}s"
    assert _programs(event) == EVERYTHING


async def test_a_slow_ci_server_is_learned_in_the_background_not_missed_on_every_describe(hiding_bridge):
    # ci-server answers in 0.9 s, longer than a Describe waits (0.5 s) but well within what
    # the probe is allowed. The first Describe offers everything, in time. The probe carries
    # on, so a later Describe has the real answer without asking again.
    hiding_bridge.fake.delays["status"] = 0.9
    hiding_bridge.fake.status_body = _status(NONE, NONE)

    started = time.monotonic()
    assert _programs(await _describe(hiding_bridge)) == EVERYTHING
    assert time.monotonic() - started < 1.0

    slowest = await _until_programs(hiding_bridge, NOTHING_BUT_CONVERSATION)
    assert slowest < 1.0
    assert hiding_bridge.fake.calls["status"] == 1


async def test_a_slow_refresh_keeps_the_last_known_answer_instead_of_flipping(bridge_stack, monkeypatch):
    monkeypatch.setattr(ci_client, "STATUS_TTL_S", 0.2)
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION

    # Time to ask again, and ci-server is slow this time and now has speech.
    bridge.fake.status_body = _status(LOCAL, LOCAL)
    bridge.fake.delays["status"] = 1.2
    await asyncio.sleep(0.25)
    # Not knowing yet, the bridge says what ci-server said last time, not everything.
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION
    await _until_programs(bridge, EVERYTHING)
    assert bridge.fake.calls["status"] == 2


async def test_describes_reuse_the_answer_instead_of_asking_every_time(hiding_bridge):
    # ci-server allows 60 requests a minute per address and real utterances share that
    # budget; a Describe every 30 seconds must not be what uses it up.
    hiding_bridge.fake.status_body = _status(NONE, LOCAL)
    for _ in range(65):
        assert _programs(await _describe(hiding_bridge)) == ([], [TTS_PROGRAM], [HANDLE_PROGRAM])
    assert hiding_bridge.fake.calls["status"] == 1


async def test_describes_that_arrive_together_share_one_probe(hiding_bridge):
    hiding_bridge.fake.delays["status"] = 0.2
    hiding_bridge.fake.status_body = _status(NONE, NONE)
    events = await asyncio.gather(*[_describe(hiding_bridge) for _ in range(20)])
    assert all(_programs(event) == NOTHING_BUT_CONVERSATION for event in events)
    assert hiding_bridge.fake.calls["status"] == 1


async def test_the_answer_is_asked_for_again_once_it_is_old(bridge_stack, monkeypatch):
    # Set speech up on ci-server, wait a moment, reload the entry, and it shows up.
    monkeypatch.setattr(ci_client, "STATUS_TTL_S", 0.5)
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION

    bridge.fake.status_body = _status(LOCAL, LOCAL)
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION  # still the answer it has
    await asyncio.sleep(0.55)
    assert _programs(await _describe(bridge)) == EVERYTHING
    assert bridge.fake.calls["status"] == 2


async def test_a_failed_probe_is_asked_again_sooner_than_a_good_one(bridge_stack, monkeypatch):
    monkeypatch.setattr(ci_client, "STATUS_RETRY_S", 0.5)  # STATUS_TTL_S stays a minute
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.modes["status"] = 503
    bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(bridge)) == EVERYTHING
    assert _programs(await _describe(bridge)) == EVERYTHING
    assert bridge.fake.calls["status"] == 1  # not asked again at once

    bridge.fake.modes["status"] = None  # ci-server is up now
    await asyncio.sleep(0.55)
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION
    assert bridge.fake.calls["status"] == 2  # and a good answer is kept for the long time


@pytest.mark.parametrize("mode", ["invalid-json", "json-list", "json-null", "plain-text"])
async def test_an_answer_that_cannot_be_read_is_asked_again_sooner_than_a_good_one(bridge_stack, monkeypatch, mode):
    monkeypatch.setattr(ci_client, "STATUS_RETRY_S", 0.5)
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.modes["status"] = mode
    bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(bridge)) == EVERYTHING

    bridge.fake.modes["status"] = None  # ci-server makes sense now
    await asyncio.sleep(0.55)
    assert _programs(await _describe(bridge)) == NOTHING_BUT_CONVERSATION
    assert bridge.fake.calls["status"] == 2


async def test_a_probe_that_never_answers_is_abandoned_and_tried_again(bridge_stack, monkeypatch):
    monkeypatch.setattr(ci_client, "STATUS_TIMEOUT_S", 0.2)
    monkeypatch.setattr(ci_client, "STATUS_RETRY_S", 0.2)
    bridge = await bridge_stack(env=HIDE)
    bridge.fake.modes["status"] = "hang"
    assert _programs(await _describe(bridge)) == EVERYTHING
    await asyncio.sleep(0.5)
    assert _programs(await _describe(bridge)) == EVERYTHING
    assert bridge.fake.calls["status"] == 2  # one probe at a time, one after the other


async def test_closing_the_client_stops_a_probe_that_is_still_running(hiding_bridge):
    hiding_bridge.fake.delays["status"] = 2.0
    hiding_bridge.fake.status_body = _status(NONE, NONE)
    assert _programs(await _describe(hiding_bridge)) == EVERYTHING  # gives up waiting after 0.5 s

    def probes():
        return [t for t in asyncio.all_tasks() if "_refresh_speech" in repr(t.get_coro()) and not t.done()]

    assert probes(), "the probe should still be running when the Describe has been answered"
    await hiding_bridge.client.close()
    assert not probes()
