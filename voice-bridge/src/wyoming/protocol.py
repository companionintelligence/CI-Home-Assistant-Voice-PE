"""
Wyoming protocol message types and helpers.

Wyoming is Home Assistant's lightweight WebSocket protocol used for
streaming audio between the Voice PE device and HA's STT/TTS pipeline.

Reference: https://github.com/rhasspy/wyoming
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class WyomingMessage:
    """A single Wyoming protocol message."""
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    payload: Optional[bytes] = None

    def to_json(self) -> str:
        envelope: dict[str, Any] = {"type": self.type, "data": self.data}
        if self.payload is not None:
            envelope["data"]["payload_length"] = len(self.payload)
        return json.dumps(envelope)

    @staticmethod
    def from_json(raw: str) -> "WyomingMessage":
        parsed = json.loads(raw)
        return WyomingMessage(
            type=parsed.get("type", ""),
            data=parsed.get("data", {}),
        )


# ---------------------------------------------------------------------------
# Well-known Wyoming message factory functions
# ---------------------------------------------------------------------------

def audio_start(rate: int = 16000, width: int = 2, channels: int = 1) -> WyomingMessage:
    """Signal start of an audio stream."""
    return WyomingMessage(
        type="audio-start",
        data={"rate": rate, "width": width, "channels": channels},
    )


def audio_chunk(pcm_bytes: bytes, rate: int = 16000) -> WyomingMessage:
    """A PCM audio chunk."""
    return WyomingMessage(
        type="audio-chunk",
        data={"rate": rate, "width": 2, "channels": 1},
        payload=pcm_bytes,
    )


def audio_stop() -> WyomingMessage:
    """Signal end of an audio stream."""
    return WyomingMessage(type="audio-stop", data={})


def transcript(text: str, is_final: bool = True) -> WyomingMessage:
    """ASR transcript result."""
    return WyomingMessage(type="transcript", data={"text": text, "is_final": is_final})


def error(message: str, code: str = "error") -> WyomingMessage:
    """Error message."""
    return WyomingMessage(type="error", data={"message": message, "code": code})
