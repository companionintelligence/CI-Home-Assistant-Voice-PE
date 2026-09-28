"""HTTP client for the ci-server OpenAI-compatible endpoints (STT, LLM, TTS)."""
from __future__ import annotations

import logging
from typing import Any, Optional

import aiohttp

from src.config import BridgeConfig

logger = logging.getLogger("voice-bridge.ci-client")


class CIServerError(RuntimeError):
    """ci-server answered with a non-2xx status or an unusable body."""


class CIClient:
    """
    Thin async client for ci-server.

    One aiohttp session is shared across calls so every utterance does not pay
    for a fresh TCP (and TLS) handshake.
    """

    def __init__(self, config: BridgeConfig) -> None:
        self._config = config
        self._session: Optional[aiohttp.ClientSession] = None
        if not config.ci_server_api_key:
            logger.warning(
                "CI_SERVER_API_KEY is not set - every ci-server call will be rejected. "
                "Set it to the same value as ci-server's MASTER_API_KEY."
            )

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self._config.request_timeout_s),
                headers={"Authorization": f"Bearer {self._config.ci_server_api_key}"},
            )
        return self._session

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()

    def _url(self, path: str) -> str:
        return f"{self._config.ci_server_url}{path}"

    @staticmethod
    async def _raise_for_status(resp: aiohttp.ClientResponse, what: str) -> None:
        if resp.status < 400:
            return
        detail = (await resp.text())[:300]
        raise CIServerError(f"{what} failed with HTTP {resp.status}: {detail}")

    async def transcribe(self, wav_bytes: bytes, language: Optional[str] = None) -> str:
        """POST a WAV file to /v1/audio/transcriptions and return the transcript."""
        form = aiohttp.FormData()
        form.add_field("file", wav_bytes, filename="audio.wav", content_type="audio/wav")
        form.add_field("model", self._config.stt_model)
        if language:
            form.add_field("language", language)

        async with self._get_session().post(
            self._url("/v1/audio/transcriptions"), data=form
        ) as resp:
            await self._raise_for_status(resp, "Transcription")
            data = await resp.json()
            return str(data.get("text", ""))

    async def respond(
        self,
        messages: list[dict[str, str]],
        instructions: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> str:
        """
        POST a conversation to /v1/responses (non-streaming) and return the reply.

        `messages` is the running conversation, oldest first, ending with the
        user's latest utterance. `session_id` lets ci-server group the turns
        when it saves them to Companion Memory.
        """
        payload: dict[str, Any] = {
            "model": self._config.model,
            "input": messages,
            "stream": False,
        }
        if instructions:
            payload["instructions"] = instructions
        if session_id:
            payload["metadata"] = {"session_id": session_id, "platform": "ha-voice-pe"}

        async with self._get_session().post(self._url("/v1/responses"), json=payload) as resp:
            await self._raise_for_status(resp, "Response generation")
            data = await resp.json()
        return extract_output_text(data)

    async def synthesize(self, text: str, voice: Optional[str] = None) -> bytes:
        """POST text to /v1/audio/speech and return WAV bytes."""
        payload = {
            "model": self._config.tts_model,
            "input": text,
            "voice": voice or self._config.tts_voice,
            "response_format": "wav",
        }
        async with self._get_session().post(self._url("/v1/audio/speech"), json=payload) as resp:
            await self._raise_for_status(resp, "Speech synthesis")
            return await resp.read()


def extract_output_text(data: dict[str, Any]) -> str:
    """Pull the assistant text out of an OpenAI Responses API body."""
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    parts: list[str] = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                parts.append(content["text"])
    return "".join(parts)
