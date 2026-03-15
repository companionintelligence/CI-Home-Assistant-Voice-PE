"""Tests for voice-bridge audio processing utilities."""
import struct
import pytest

from src.audio.processing import (
    RingBuffer,
    VoiceActivityDetector,
    pcm_to_wav,
    rms,
)


def make_pcm(amplitude: int = 0, num_samples: int = 320) -> bytes:
    """Create synthetic PCM bytes (Int16 LE)."""
    return struct.pack(f"<{num_samples}h", *([amplitude] * num_samples))


class TestRingBuffer:
    def test_push_and_drain(self):
        buf = RingBuffer(maxlen=5)
        for i in range(3):
            buf.push(b"frame")
        frames = buf.drain()
        assert len(frames) == 3
        assert buf.is_empty

    def test_maxlen_drops_oldest(self):
        buf = RingBuffer(maxlen=2)
        buf.push(b"a")
        buf.push(b"b")
        buf.push(b"c")  # "a" should be dropped
        frames = buf.drain()
        assert frames == [b"b", b"c"]

    def test_len(self):
        buf = RingBuffer(maxlen=10)
        buf.push(b"x")
        buf.push(b"y")
        assert len(buf) == 2


class TestRms:
    def test_silence_is_zero(self):
        silent = make_pcm(0)
        assert rms(silent) == 0.0

    def test_loud_is_positive(self):
        loud = make_pcm(10000)
        assert rms(loud) > 0.0

    def test_empty_bytes(self):
        assert rms(b"") == 0.0


class TestVAD:
    def test_loud_activates_speech(self):
        vad = VoiceActivityDetector(threshold=100, silence_timeout=3)
        loud = make_pcm(5000)
        assert vad.process(loud) is True
        assert vad.speech_active is True

    def test_silence_ends_speech_after_timeout(self):
        vad = VoiceActivityDetector(threshold=100, silence_timeout=3)
        loud = make_pcm(5000)
        silent = make_pcm(0)

        vad.process(loud)
        assert vad.speech_active is True

        # Not yet timed out
        vad.process(silent)
        vad.process(silent)
        assert vad.speech_active is True

        # Timeout reached
        vad.process(silent)
        assert vad.speech_active is False

    def test_reset_clears_state(self):
        vad = VoiceActivityDetector(threshold=100, silence_timeout=3)
        vad.process(make_pcm(5000))
        assert vad.speech_active is True
        vad.reset()
        assert vad.speech_active is False


class TestPcmToWav:
    def test_output_is_valid_wav(self):
        import wave, io
        pcm = make_pcm(1000)
        wav = pcm_to_wav([pcm], sample_rate=16000)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            assert wf.getframerate() == 16000
            assert wf.getnchannels() == 1
            assert wf.getsampwidth() == 2

    def test_multiple_frames_concatenated(self):
        import wave, io
        frames = [make_pcm(100, 320) for _ in range(5)]
        wav = pcm_to_wav(frames, sample_rate=16000)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            assert wf.getnframes() == 320 * 5

    def test_empty_frames(self):
        wav = pcm_to_wav([], sample_rate=16000)
        assert wav[:4] == b"RIFF"
