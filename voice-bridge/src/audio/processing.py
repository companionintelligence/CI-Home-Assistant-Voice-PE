"""Audio utilities – PCM buffering, VAD logic, and WAV conversion."""
from __future__ import annotations

import io
import struct
import wave
from collections import deque
from typing import Deque, Optional

# ---------------------------------------------------------------------------
# VAD constants (simple energy-based fallback)
# ---------------------------------------------------------------------------
SILENCE_THRESHOLD = 200          # RMS below this → silence
SILENCE_TIMEOUT_FRAMES = 20      # consecutive silent frames before VAD=false
MAX_BUFFER_FRAMES = 500          # hard cap (~10 s at 20 ms/frame @ 16 kHz)
FRAME_DURATION_MS = 20           # ms per audio chunk


class RingBuffer:
    """
    Fixed-capacity ring buffer for PCM audio frames (bytes).
    Oldest frames are dropped when capacity is exceeded.
    """

    def __init__(self, maxlen: int = MAX_BUFFER_FRAMES) -> None:
        self._buf: Deque[bytes] = deque(maxlen=maxlen)

    def push(self, frame: bytes) -> None:
        self._buf.append(frame)

    def drain(self) -> list[bytes]:
        frames = list(self._buf)
        self._buf.clear()
        return frames

    def __len__(self) -> int:
        return len(self._buf)

    @property
    def is_empty(self) -> bool:
        return len(self._buf) == 0


def rms(pcm_bytes: bytes) -> float:
    """Compute root-mean-square of Int16 PCM samples."""
    if not pcm_bytes:
        return 0.0
    num_samples = len(pcm_bytes) // 2
    if num_samples == 0:
        return 0.0
    samples = struct.unpack(f"<{num_samples}h", pcm_bytes[:num_samples * 2])
    sq_sum = sum(s * s for s in samples)
    return (sq_sum / num_samples) ** 0.5


class VoiceActivityDetector:
    """
    Simple energy-based VAD.
    Returns True (speech detected) / False (silence) based on RMS energy.
    """

    def __init__(
        self,
        threshold: float = SILENCE_THRESHOLD,
        silence_timeout: int = SILENCE_TIMEOUT_FRAMES,
    ) -> None:
        self._threshold = threshold
        self._silence_timeout = silence_timeout
        self._silent_frames = 0
        self._speech_started = False

    @property
    def speech_active(self) -> bool:
        return self._speech_started

    def process(self, pcm_bytes: bytes) -> bool:
        """
        Feed a PCM frame. Returns True if speech is currently active.
        Transitions:
          - silence → speech when RMS > threshold
          - speech → silence after silence_timeout consecutive silent frames
        """
        energy = rms(pcm_bytes)
        if energy >= self._threshold:
            self._silent_frames = 0
            self._speech_started = True
        else:
            self._silent_frames += 1
            if self._silent_frames >= self._silence_timeout:
                self._speech_started = False

        return self._speech_started

    def reset(self) -> None:
        self._silent_frames = 0
        self._speech_started = False


def pcm_to_wav(pcm_frames: list[bytes], sample_rate: int = 16000, channels: int = 1) -> bytes:
    """
    Concatenate Int16 PCM frames and wrap in a WAV container.

    Args:
        pcm_frames: list of raw PCM byte strings (Int16 LE)
        sample_rate: audio sample rate in Hz
        channels: number of audio channels (1 = mono)

    Returns:
        WAV-encoded bytes ready for upload to STT endpoint.
    """
    raw = b"".join(pcm_frames)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)          # 16-bit = 2 bytes per sample
        wf.setframerate(sample_rate)
        wf.writeframes(raw)
    return buf.getvalue()
