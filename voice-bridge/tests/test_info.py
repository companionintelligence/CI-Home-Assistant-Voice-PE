"""Tests for the Wyoming info description."""
from src.config import BridgeConfig
from src.wyoming.info import HANDLE_PROGRAM, STT_PROGRAM, TTS_PROGRAM, build_info


def test_offers_stt_tts_and_conversation():
    cfg = BridgeConfig.from_env({"CI_TTS_VOICES": "alloy,nova", "LANGUAGES": "en,fr"})
    info = build_info(cfg)
    assert [p.name for p in info.asr] == [STT_PROGRAM]
    assert [p.name for p in info.tts] == [TTS_PROGRAM]
    assert [p.name for p in info.handle] == [HANDLE_PROGRAM]
    assert [v.name for v in info.tts[0].voices] == ["alloy", "nova"]
    assert info.asr[0].models[0].languages == ["en", "fr"]
    assert all(p.installed for p in info.asr + info.tts + info.handle)


def test_info_event_serializes():
    event = build_info(BridgeConfig()).event()
    assert event.type == "info"
    assert event.data["handle"][0]["name"] == HANDLE_PROGRAM
