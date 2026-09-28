"""Tests for BridgeConfig.from_env."""
from src.config import BridgeConfig


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
