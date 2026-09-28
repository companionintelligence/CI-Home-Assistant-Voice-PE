"""Tests for voice-bridge audio helpers."""
import io
import struct
import wave

import pytest

from src.audio.processing import chunk_pcm, pcm_to_wav, wav_to_pcm


def make_pcm(amplitude: int = 0, num_samples: int = 320) -> bytes:
    """Synthetic Int16 LE PCM."""
    return struct.pack(f"<{num_samples}h", *([amplitude] * num_samples))


class TestPcmToWav:
    def test_output_is_valid_wav(self):
        wav = pcm_to_wav(make_pcm(1000), sample_rate=16000)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            assert wf.getframerate() == 16000
            assert wf.getnchannels() == 1
            assert wf.getsampwidth() == 2
            assert wf.getnframes() == 320

    def test_empty_pcm_still_valid(self):
        wav = pcm_to_wav(b"")
        assert wav[:4] == b"RIFF"


class TestWavToPcm:
    def test_round_trip(self):
        pcm = make_pcm(1234, 480)
        decoded = wav_to_pcm(pcm_to_wav(pcm, sample_rate=22050))
        assert decoded.rate == 22050
        assert decoded.width == 2
        assert decoded.channels == 1
        assert decoded.pcm == pcm

    def test_rejects_non_wav(self):
        with pytest.raises(ValueError, match="not WAV"):
            wav_to_pcm(b"ID3\x04" + b"\x00" * 64)


class TestChunkPcm:
    def test_chunks_align_to_frames(self):
        pcm = make_pcm(1, 2500)
        chunks = chunk_pcm(pcm, width=2, channels=1, samples_per_chunk=1024)
        assert [len(c) for c in chunks] == [2048, 2048, 904]
        assert b"".join(chunks) == pcm

    def test_empty(self):
        assert chunk_pcm(b"", width=2, channels=1) == []
