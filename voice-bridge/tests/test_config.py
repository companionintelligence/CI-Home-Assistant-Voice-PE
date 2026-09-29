"""Tests for BridgeConfig.from_env."""
import pytest

from src.config import BridgeConfig, debug_enabled


def test_defaults():
    cfg = BridgeConfig.from_env({})
    assert cfg.ci_server_url == "http://localhost:8080"
    assert cfg.ci_server_api_key == ""
    assert cfg.port == 10700
    assert cfg.languages == ["en"]
    assert cfg.tts_voices == ["alloy"]
    assert cfg.zeroconf is False


def test_overrides():
    cfg = BridgeConfig.from_env(
        {
            "CI_SERVER_URL": "http://ci-server:8080/",
            "CI_SERVER_API_KEY": "k",
            "CI_MODEL": "ollama:qwen3:4b",
            "CI_TTS_VOICE": "af_heart",
            "CI_TTS_VOICES": "am_adam, af_bella",
            "LANGUAGES": "en, de",
            "VOICE_BRIDGE_PORT": "10800",
            "WYOMING_ZEROCONF": "true",
        }
    )
    assert cfg.ci_server_url == "http://ci-server:8080"
    assert cfg.model == "ollama:qwen3:4b"
    # The default voice is always offered, first.
    assert cfg.tts_voices == ["af_heart", "am_adam", "af_bella"]
    assert cfg.languages == ["en", "de"]
    assert cfg.port == 10800
    assert cfg.zeroconf is True


def test_transcripts_stay_out_of_the_logs_unless_asked():
    assert BridgeConfig().log_transcripts is False
    assert BridgeConfig.from_env({}).log_transcripts is False
    assert BridgeConfig.from_env({"LOG_TRANSCRIPTS": "false"}).log_transcripts is False
    assert BridgeConfig.from_env({"LOG_TRANSCRIPTS": ""}).log_transcripts is False
    assert BridgeConfig.from_env({"LOG_TRANSCRIPTS": "true"}).log_transcripts is True
    assert BridgeConfig.from_env({"LOG_TRANSCRIPTS": " 1 "}).log_transcripts is True


def test_hiding_unconfigured_speech_is_off_unless_asked():
    assert BridgeConfig().hide_unconfigured_speech is False
    assert BridgeConfig.from_env({}).hide_unconfigured_speech is False
    assert BridgeConfig.from_env({"HIDE_UNCONFIGURED_SPEECH": "false"}).hide_unconfigured_speech is False
    assert BridgeConfig.from_env({"HIDE_UNCONFIGURED_SPEECH": ""}).hide_unconfigured_speech is False
    assert BridgeConfig.from_env({"HIDE_UNCONFIGURED_SPEECH": "true"}).hide_unconfigured_speech is True
    assert BridgeConfig.from_env({"HIDE_UNCONFIGURED_SPEECH": " 1 "}).hide_unconfigured_speech is True


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " true "])
def test_debug_is_on_only_for_yes_like_words(value):
    assert debug_enabled({"DEBUG": value}) is True


@pytest.mark.parametrize("value", ["0", "false", "False", "no", "off", "", "  ", "anything-else"])
def test_debug_zero_and_false_do_not_turn_debug_on(value):
    assert debug_enabled({"DEBUG": value}) is False


def test_debug_is_off_when_unset():
    assert debug_enabled({}) is False
