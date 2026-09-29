"""
Shared test harness: a ci-server stand-in that can misbehave on every route, the
bridge wired to it behind a real Wyoming TCP server, and copies of the read loops
Home Assistant's Wyoming integration runs against a server.

The fixtures that build these live in conftest.py.
"""
from __future__ import annotations

import asyncio
import gc
import io
import struct
import traceback
import wave
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Union

import pytest
from aiohttp import web
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.client import AsyncTcpClient
from wyoming.error import Error
from wyoming.event import Event, async_read_event
from wyoming.handle import Handled, NotHandled
from wyoming.server import AsyncTcpServer
from wyoming.tts import Synthesize

from src.client.ci_client import CIClient
from src.config import BridgeConfig
from src.conversation import ConversationStore

API_KEY = "test-key"

# How long a test waits for something that should be immediate (a reply, a close).
PATIENCE_S = 2.0

# A route mode is None (answer normally), an HTTP status, (status, headers), or one of:
#   "invalid-json"  200 with a body that is not JSON
#   "json-list"     200 with `[]`
#   "json-null"     200 with `null`
#   "plain-text"    200 with a text/plain body
#   "empty"         200 with a well-formed body that carries no text or audio
#   "hang"          never answers until the fake is released
#   "drop"          starts the body, then cuts the connection
Mode = Union[None, int, tuple, str]


def wav_bytes(num_samples: int = 2400, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(struct.pack(f"<{num_samples}h", *([500] * num_samples)))
    return buf.getvalue()


class FakeCIServer:
    """ci-server as the bridge sees it: four routes, each of which can be told to fail."""

    def __init__(self) -> None:
        self.modes: dict[str, Mode] = {}
        self.delays: dict[str, float] = {}  # seconds a route waits before it answers normally
        self.calls: dict[str, int] = {"stt": 0, "responses": 0, "speech": 0, "status": 0}
        self.responses: list[dict] = []
        self.speech_body: bytes = wav_bytes()
        self.status_body: Any = {
            "version": "test",
            "stt": {"provider": "local", "model": None},
            "tts": {"provider": "local", "model": None},
        }
        self.gate = asyncio.Event()  # held closed for "hang" routes, opened at teardown
        self.release = self.gate.set

    def _authorized(self, request: web.Request) -> bool:
        return request.headers.get("Authorization") == f"Bearer {API_KEY}"

    async def _route(
        self, route: str, request: web.Request, ok: Callable[[], Awaitable[web.StreamResponse]]
    ) -> web.StreamResponse:
        self.calls[route] += 1
        await request.read()
        if not self._authorized(request):
            return web.json_response({"error": {"code": "invalid_api_key"}}, status=401)
        mode = self.modes.get(route)
        if mode is None:
            if self.delays.get(route):
                await asyncio.sleep(self.delays[route])
            return await ok()
        if isinstance(mode, int):
            return web.json_response({"error": {"code": "upstream_error"}}, status=mode)
        if isinstance(mode, tuple):
            status, headers = mode
            return web.json_response({"error": {"code": "upstream_error"}}, status=status, headers=headers)
        if mode == "invalid-json":
            return web.Response(body=b"{not json", content_type="application/json")
        if mode == "json-list":
            return web.json_response([])
        if mode == "json-null":
            return web.Response(body=b"null", content_type="application/json")
        if mode == "plain-text":
            return web.Response(text="upstream says hello", content_type="text/plain")
        if mode == "empty":
            if route == "speech":
                return web.Response(body=b"", content_type="audio/wav")
            if route == "responses":
                return web.json_response({"output": []})
            return web.json_response({"text": ""})
        if mode == "hang":
            await self.gate.wait()
            return await ok()
        if mode == "drop":
            resp = web.StreamResponse(headers={"Content-Type": "application/json", "Content-Length": "5000"})
            await resp.prepare(request)
            await resp.write(b'{"text": "cut off')
            assert request.transport is not None
            request.transport.abort()
            return resp
        raise AssertionError(f"unknown mode {mode!r}")

    async def stt(self, request: web.Request) -> web.StreamResponse:
        async def ok() -> web.StreamResponse:
            return web.json_response({"text": " turn on the kitchen lights "})

        return await self._route("stt", request, ok)

    async def respond(self, request: web.Request) -> web.StreamResponse:
        async def ok() -> web.StreamResponse:
            self.responses.append(await request.json())
            turn = len(self.responses)
            return web.json_response(
                {
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": f"Answer {turn}."}],
                        }
                    ]
                }
            )

        return await self._route("responses", request, ok)

    async def speech(self, request: web.Request) -> web.StreamResponse:
        async def ok() -> web.StreamResponse:
            return web.Response(body=self.speech_body, content_type="audio/wav")

        return await self._route("speech", request, ok)

    async def status(self, request: web.Request) -> web.StreamResponse:
        async def ok() -> web.StreamResponse:
            return web.json_response(self.status_body)

        return await self._route("status", request, ok)

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/v1/audio/transcriptions", self.stt)
        app.router.add_post("/v1/responses", self.respond)
        app.router.add_post("/v1/audio/speech", self.speech)
        app.router.add_get("/v1/status", self.status)
        return app


class LoopErrors:
    """Collects what asyncio would log as 'Task exception was never retrieved' and friends."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.items: list[dict[str, Any]] = []
        loop.set_exception_handler(self._collect)

    def _collect(self, _loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        self.items.append(context)

    async def settle(self) -> None:
        """Let finished handler tasks be collected; that is when unretrieved exceptions surface."""
        await asyncio.sleep(0.02)
        gc.collect()
        await asyncio.sleep(0.02)
        gc.collect()

    def describe(self) -> str:
        parts = []
        for context in self.items:
            exc = context.get("exception")
            trace = "".join(traceback.format_exception(exc)[-4:]) if exc is not None else ""
            parts.append(f"{context.get('message')}: {exc!r}\n{trace}")
        return "\n".join(parts)


@dataclass
class Stack:
    fake: FakeCIServer
    config: BridgeConfig
    client: CIClient
    conversations: ConversationStore
    server: AsyncTcpServer
    wyoming_port: int

    def connect(self) -> AsyncTcpClient:
        return AsyncTcpClient("127.0.0.1", self.wyoming_port, connect_timeout=5, read_timeout=5)

    async def open_raw(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        return await asyncio.open_connection("127.0.0.1", self.wyoming_port)


# ------------------------------------------------------------------ reading

HUNG = object()


async def read(client: AsyncTcpClient, timeout: float = PATIENCE_S) -> Union[Event, None, object]:
    """Next event, None on end of stream, or HUNG when nothing arrives in time."""
    try:
        return await asyncio.wait_for(client.read_event(), timeout)
    except asyncio.TimeoutError:
        return HUNG


async def read_raw(reader: asyncio.StreamReader, timeout: float = PATIENCE_S) -> Union[Event, None, object]:
    """Like read(), for a connection opened with Stack.open_raw()."""
    try:
        return await asyncio.wait_for(async_read_event(reader), timeout)
    except asyncio.TimeoutError:
        return HUNG


def describe_read(item: object) -> str:
    if item is HUNG:
        return "nothing within the wait (connection still open)"
    if item is None:
        return "end of stream"
    return f"event {getattr(item, 'type', item)!r}"


async def send_utterance(client: AsyncTcpClient, frames: int = 1600) -> None:
    """What Home Assistant sends for one spoken request: 16 kHz mono audio, then audio-stop."""
    await client.write_event(Transcribe(language="en").event())
    await client.write_event(AudioStart(rate=16000, width=2, channels=1).event())
    await client.write_event(AudioChunk(rate=16000, width=2, channels=1, audio=b"\x01\x00" * frames).event())
    await client.write_event(AudioStop().event())


# ------------------------------------------------ Home Assistant's read loops
#
# Copied in control flow from Home Assistant's components/wyoming: stt.py
# (async_process_audio_stream), tts.py (async_get_tts_audio) and conversation.py
# (async_process). None of them has a timeout of its own, so a bridge that goes quiet
# after an error hangs the whole pipeline. Two shapes exist, and the read loops here
# take `reads_errors` to pick one:
#
#   False, as in 2026.2.3 and every release checked from 2025.10 through 2026.7: no loop
#          looks at an error event. Each leaves only on the events named below or on end
#          of stream.
#   True, as in 2026.8.3 and 2026.9.4: each loop also stops on an error event (stt.py
#          returns SpeechResult ERROR, tts.py raises HomeAssistantError, conversation.py
#          sets an error response).
#
# `HA_SHAPES` runs a test once per shape.

HA_SHAPES = pytest.mark.parametrize(
    "reads_errors",
    [pytest.param(False, id="ha-2026.2.3"), pytest.param(True, id="ha-2026.9.4")],
)


async def ha_stt(port: int, timeout: float = PATIENCE_S, reads_errors: bool = False) -> tuple[str, Optional[str]]:
    """stt.py: leaves on end of stream or an error event (SpeechResult ERROR) or a transcript."""

    async def run() -> tuple[str, Optional[str]]:
        async with AsyncTcpClient("127.0.0.1", port) as client:
            await send_utterance(client)
            while True:
                event = await client.read_event()
                if event is None:
                    return ("error", None)
                if reads_errors and Error.is_type(event.type):
                    return ("error", None)
                if Transcript.is_type(event.type):
                    return ("text", Transcript.from_event(event).text)

    try:
        return await asyncio.wait_for(run(), timeout)
    except asyncio.TimeoutError:
        return ("hung", None)


async def ha_tts(port: int, timeout: float = PATIENCE_S, reads_errors: bool = False) -> tuple[str, Optional[int]]:
    """tts.py: leaves on end of stream (no audio), an error event (HomeAssistantError) or audio-stop."""

    async def run() -> tuple[str, Optional[int]]:
        async with AsyncTcpClient("127.0.0.1", port) as client:
            await client.write_event(Synthesize(text="hello", voice=None).event())
            pcm = 0
            while True:
                event = await client.read_event()
                if event is None:
                    return ("no-audio", None)
                if reads_errors and Error.is_type(event.type):
                    return ("error-event", None)
                if AudioStop.is_type(event.type):
                    return ("audio", pcm)
                if AudioChunk.is_type(event.type):
                    pcm += len(AudioChunk.from_event(event).audio)

    try:
        return await asyncio.wait_for(run(), timeout)
    except asyncio.TimeoutError:
        return ("hung", None)


async def ha_conversation(
    port: int, timeout: float = PATIENCE_S, reads_errors: bool = False
) -> tuple[str, Optional[str]]:
    """conversation.py: leaves on end of stream, an error event, handled or not-handled."""

    async def run() -> tuple[str, Optional[str]]:
        async with AsyncTcpClient("127.0.0.1", port) as client:
            await client.write_event(Transcript(text="hi", context={"conversation_id": "c1"}).event())
            while True:
                event = await client.read_event()
                if event is None:
                    return ("lost", None)
                if reads_errors and Error.is_type(event.type):
                    return ("error-event", Error.from_event(event).text)
                if Handled.is_type(event.type):
                    return ("handled", Handled.from_event(event).text)
                if NotHandled.is_type(event.type):
                    return ("not-handled", NotHandled.from_event(event).text)

    try:
        return await asyncio.wait_for(run(), timeout)
    except asyncio.TimeoutError:
        return ("hung", None)
