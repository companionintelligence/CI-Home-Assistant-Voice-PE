"""CI-server HTTP client for STT, chat completions, and TTS."""
from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator, Optional

import aiohttp

CI_SERVER_URL = os.environ.get("CI_SERVER_URL", "http://localhost:8080")
CI_SERVER_API_KEY = os.environ.get("CI_SERVER_API_KEY", "dev-key-change-me")
DEFAULT_MODEL = os.environ.get("CI_MODEL", "ollama:llama2")
DEFAULT_TTS_MODEL = os.environ.get("CI_TTS_MODEL", "tts-1")
DEFAULT_TTS_VOICE = os.environ.get("CI_TTS_VOICE", "alloy")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {CI_SERVER_API_KEY}",
        "Content-Type": "application/json",
    }


async def transcribe(wav_bytes: bytes, language: Optional[str] = None) -> str:
    """
    Send a WAV file to /v1/audio/transcriptions and return the transcript.

    Args:
        wav_bytes: WAV-encoded audio bytes.
        language: Optional BCP-47 language hint (e.g. 'en').

    Returns:
        Transcript text string.
    """
    async with aiohttp.ClientSession() as session:
        form = aiohttp.FormData()
        form.add_field(
            "file",
            wav_bytes,
            filename="audio.wav",
            content_type="audio/wav",
        )
        form.add_field("model", "whisper-1")
        if language:
            form.add_field("language", language)

        async with session.post(
            f"{CI_SERVER_URL}/v1/audio/transcriptions",
            data=form,
            headers={"Authorization": f"Bearer {CI_SERVER_API_KEY}"},
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get("text", "")


async def stream_responses(
    text: str,
    instructions: Optional[str] = None,
    previous_response_id: Optional[str] = None,
) -> AsyncIterator[str]:
    """
    Send text to /v1/responses with streaming=true and yield text deltas.

    Args:
        text: User's utterance (transcript).
        instructions: Optional system instructions.
        previous_response_id: For multi-turn conversation continuity.

    Yields:
        Text delta strings as they arrive from the SSE stream.
    """
    payload: dict = {
        "model": DEFAULT_MODEL,
        "input": text,
        "stream": True,
    }
    if instructions:
        payload["instructions"] = instructions
    if previous_response_id:
        payload["previous_response_id"] = previous_response_id

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{CI_SERVER_URL}/v1/responses",
            json=payload,
            headers=_headers(),
        ) as resp:
            resp.raise_for_status()
            buf = b""
            async for chunk in resp.content.iter_any():
                buf += chunk
                while b"\n" in buf:
                    raw_line, buf = buf.split(b"\n", 1)
                    decoded = raw_line.decode("utf-8").strip()
                    if not decoded or decoded.startswith(":"):
                        continue
                    if decoded.startswith("data: "):
                        raw = decoded[6:]
                        if raw == "[DONE]":
                            return
                        try:
                            event = json.loads(raw)
                            if event.get("type") == "response.output_text.delta":
                                delta = event.get("delta", "")
                                if delta:
                                    yield delta
                        except json.JSONDecodeError:
                            pass


async def synthesize_speech(
    text: str,
    voice: str = DEFAULT_TTS_VOICE,
    fmt: str = "mp3",
) -> bytes:
    """
    Call /v1/audio/speech and return MP3 (or other format) bytes.

    Args:
        text: Text to synthesize.
        voice: TTS voice name.
        fmt: Audio format (mp3, wav, etc.).

    Returns:
        Raw audio bytes.
    """
    payload = {
        "model": DEFAULT_TTS_MODEL,
        "input": text,
        "voice": voice,
        "format": fmt,
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{CI_SERVER_URL}/v1/audio/speech",
            json=payload,
            headers=_headers(),
        ) as resp:
            resp.raise_for_status()
            return await resp.read()
