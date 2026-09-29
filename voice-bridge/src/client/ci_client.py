"""HTTP client for the ci-server OpenAI-compatible endpoints (STT, LLM, TTS)."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, NamedTuple, Optional

import aiohttp

from src.config import BridgeConfig

logger = logging.getLogger("voice-bridge.ci-client")

# Home Assistant waits for the answer to Describe (`_INFO_TIMEOUT` in its wyoming/data.py,
# per attempt): 1 s in the releases from 2025.10 through 2026.5, 5 s from 2026.7. So a
# Describe waits at most half of the shorter limit for the status probe. A probe that is
# not done by then does not hold Describe up: it keeps running for the next one, and this
# Describe answers from what the bridge last learned, or offers everything.
STATUS_WAIT_S = 0.5
# The probe itself may take longer than a Describe waits: ci-server checks its LLM backend
# (up to 2 s) and Companion Memory (up to 1.5 s) before it answers /v1/status.
STATUS_TIMEOUT_S = 4.0
# How long an answer is reused. Every /v1/status makes ci-server call its LLM backend and
# Companion Memory, and the container healthcheck sends a Describe every 30 seconds, so
# the answer is kept instead of asked for again on each Describe. A minute is short enough
# to notice speech being set up on ci-server.
STATUS_TTL_S = 60.0
# A probe that failed or could not be read leaves everything on; ask again sooner.
STATUS_RETRY_S = 10.0

# What went wrong with a ci-server call, as classify() reports it.
AUTH = "auth"
RATE_LIMIT = "rate_limit"
TIMEOUT = "timeout"
UNREACHABLE = "unreachable"
BAD_RESPONSE = "bad_response"


class CIServerError(RuntimeError):
    """ci-server answered with a non-2xx status or an unusable body."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


def classify(exc: BaseException) -> str:
    """Name the cause of a failed ci-server call so the bridge can say something useful."""
    # aiohttp's ServerTimeoutError is also a connection error, so timeouts go first.
    if isinstance(exc, asyncio.TimeoutError):
        return TIMEOUT
    if isinstance(exc, CIServerError) and exc.status is not None:
        if exc.status in (401, 403):
            return AUTH
        if exc.status == 429:
            return RATE_LIMIT
        if exc.status >= 500:
            return UNREACHABLE
        return BAD_RESPONSE
    if isinstance(exc, aiohttp.ContentTypeError):
        return BAD_RESPONSE
    if isinstance(exc, aiohttp.ClientError):
        return UNREACHABLE
    return BAD_RESPONSE


class _SpeechAnswer(NamedTuple):
    offered: tuple[bool, bool]  # (stt, tts)
    known: bool  # ci-server gave a readable answer, as opposed to the bridge offering everything
    expires: float  # time.monotonic()


class CIClient:
    """
    Thin async client for ci-server.

    One aiohttp session is shared across calls so every utterance does not pay
    for a fresh TCP (and TLS) handshake.
    """

    def __init__(self, config: BridgeConfig) -> None:
        self._config = config
        self._session: Optional[aiohttp.ClientSession] = None
        self._speech: Optional[_SpeechAnswer] = None
        self._speech_logged: Optional[tuple[bool, bool]] = None
        self._speech_refresh: Optional[asyncio.Future] = None
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
        refresh = self._speech_refresh
        if refresh is not None and not refresh.done():
            refresh.cancel()
            await asyncio.gather(refresh, return_exceptions=True)
        if self._session is not None and not self._session.closed:
            await self._session.close()

    def _url(self, path: str) -> str:
        return f"{self._config.ci_server_url}{path}"

    @staticmethod
    async def _raise_for_status(resp: aiohttp.ClientResponse) -> None:
        if resp.status < 400:
            return
        detail = (await resp.text())[:300]
        raise CIServerError(f"HTTP {resp.status}: {detail}", status=resp.status)

    @staticmethod
    async def _json_object(resp: aiohttp.ClientResponse) -> dict[str, Any]:
        try:
            data = await resp.json()
        except (ValueError, aiohttp.ContentTypeError) as exc:
            raise CIServerError(f"response was not valid JSON ({type(exc).__name__})") from exc
        if not isinstance(data, dict):
            raise CIServerError(f"unexpected JSON body: {type(data).__name__}")
        return data

    async def speech_available(self) -> tuple[bool, bool]:
        """
        Which speech backends ci-server has (GET /v1/status), as (stt, tts).

        Only an explicit provider of "none" turns a side off. A slow, failing or
        unfamiliar answer (an older ci-server, a 401, a body without those fields)
        leaves both on, which is what the bridge always advertised before.

        The answer is kept for STATUS_TTL_S (STATUS_RETRY_S after a failure), and one
        probe at a time asks ci-server. A Describe waits at most STATUS_WAIT_S for it: a
        slow ci-server neither delays Describe nor is asked again on every call.
        """
        cached = self._speech
        if cached is not None and time.monotonic() < cached.expires:
            return cached.offered
        refresh = self._speech_refresh
        if refresh is None or refresh.done():
            refresh = self._speech_refresh = asyncio.ensure_future(self._refresh_speech())
        try:
            # shield: a Describe that gives up, or is cancelled, must not cancel the probe
            return await asyncio.wait_for(asyncio.shield(refresh), STATUS_WAIT_S)
        except asyncio.TimeoutError:
            # Still asking. An answer ci-server gave earlier beats guessing.
            return cached.offered if cached is not None and cached.known else (True, True)

    async def _refresh_speech(self) -> tuple[bool, bool]:
        offered, known = await self._probe_speech()
        ttl = STATUS_TTL_S if known else STATUS_RETRY_S
        self._speech = _SpeechAnswer(offered, known, time.monotonic() + ttl)
        if offered != self._speech_logged:
            self._speech_logged = offered
            missing = [name for name, on in zip(("speech-to-text", "text-to-speech"), offered) if not on]
            if missing:
                logger.info(
                    "ci-server has no %s configured; not offering it to Home Assistant "
                    "(set STT_BASE_URL or OPENAI_API_KEY on ci-server, wait a minute, then reload the Wyoming entry)",
                    " or ".join(missing),
                )
        return offered

    async def _probe_speech(self) -> tuple[tuple[bool, bool], bool]:
        """One GET /v1/status: ((stt, tts), whether ci-server gave a readable answer)."""
        try:
            async with self._get_session().get(
                self._url("/v1/status"), timeout=aiohttp.ClientTimeout(total=STATUS_TIMEOUT_S)
            ) as resp:
                if resp.status != 200:
                    logger.debug("ci-server /v1/status answered HTTP %d; offering all speech services", resp.status)
                    return (True, True), False
                data = await resp.json()
        except Exception as exc:  # noqa: BLE001 - a failed probe must never break Describe
            logger.debug("ci-server /v1/status probe failed (%s); offering all speech services", classify(exc))
            return (True, True), False
        offered = (not _is_unconfigured(data, "stt"), not _is_unconfigured(data, "tts"))
        return offered, isinstance(data, dict)

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
            await self._raise_for_status(resp)
            data = await self._json_object(resp)
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
            await self._raise_for_status(resp)
            data = await self._json_object(resp)
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
            await self._raise_for_status(resp)
            return await resp.read()


def _is_unconfigured(status: Any, side: str) -> bool:
    """True only when a /v1/status body says outright that `side` ("stt" or "tts") has no provider."""
    section = status.get(side) if isinstance(status, dict) else None
    return isinstance(section, dict) and section.get("provider") == "none"


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
