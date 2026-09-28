"""Audio helpers: PCM to WAV for STT uploads, and WAV to PCM chunks for TTS playback."""
from __future__ import annotations

import io
import wave
from dataclasses import dataclass

# Format ci-server STT backends expect, and what HA streams by default.
STT_RATE = 16000
STT_WIDTH = 2
STT_CHANNELS = 1


def pcm_to_wav(
    pcm: bytes, sample_rate: int = STT_RATE, width: int = STT_WIDTH, channels: int = STT_CHANNELS
) -> bytes:
    """Wrap raw little-endian PCM in a WAV container, ready for upload to an STT endpoint."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


@dataclass(frozen=True)
class DecodedWav:
    rate: int
    width: int
    channels: int
    pcm: bytes


def wav_to_pcm(wav_bytes: bytes) -> DecodedWav:
    """
    Decode a WAV file into raw PCM plus its format.

    Raises ValueError if the bytes are not a WAV file (for example an MP3 from a
    TTS backend that ignored the requested response_format).
    """
    if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("TTS audio is not WAV; configure the TTS backend to return wav")
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        return DecodedWav(
            rate=wf.getframerate(),
            width=wf.getsampwidth(),
            channels=wf.getnchannels(),
            pcm=wf.readframes(wf.getnframes()),
        )


def chunk_pcm(pcm: bytes, width: int, channels: int, samples_per_chunk: int = 1024) -> list[bytes]:
    """Split PCM into chunks aligned to whole sample frames."""
    step = samples_per_chunk * width * channels
    return [pcm[i : i + step] for i in range(0, len(pcm), step)]
