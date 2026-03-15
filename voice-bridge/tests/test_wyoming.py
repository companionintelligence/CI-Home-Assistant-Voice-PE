"""Tests for Wyoming protocol helpers."""
import json

from src.wyoming.protocol import (
    WyomingMessage,
    audio_start,
    audio_chunk,
    audio_stop,
    transcript,
    error,
)


class TestWyomingMessage:
    def test_to_json(self):
        msg = WyomingMessage(type="test", data={"key": "value"})
        raw = msg.to_json()
        parsed = json.loads(raw)
        assert parsed["type"] == "test"
        assert parsed["data"]["key"] == "value"

    def test_from_json(self):
        raw = '{"type":"audio-start","data":{"rate":16000}}'
        msg = WyomingMessage.from_json(raw)
        assert msg.type == "audio-start"
        assert msg.data["rate"] == 16000

    def test_payload_length_in_json(self):
        msg = WyomingMessage(type="audio-chunk", data={}, payload=b"\x00" * 64)
        raw = msg.to_json()
        parsed = json.loads(raw)
        assert parsed["data"]["payload_length"] == 64


class TestWyomingFactories:
    def test_audio_start(self):
        msg = audio_start(rate=48000)
        assert msg.type == "audio-start"
        assert msg.data["rate"] == 48000

    def test_audio_chunk(self):
        msg = audio_chunk(b"\x01\x02", rate=16000)
        assert msg.type == "audio-chunk"
        assert msg.payload == b"\x01\x02"

    def test_audio_stop(self):
        msg = audio_stop()
        assert msg.type == "audio-stop"

    def test_transcript(self):
        msg = transcript("hello world", is_final=True)
        assert msg.type == "transcript"
        assert msg.data["text"] == "hello world"
        assert msg.data["is_final"] is True

    def test_error(self):
        msg = error("something went wrong")
        assert msg.type == "error"
        assert "something went wrong" in msg.data["message"]
