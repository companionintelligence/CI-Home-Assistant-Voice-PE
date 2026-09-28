"""
End-to-end tests: a real Wyoming TCP client talks to the bridge, and the bridge
talks to a fake ci-server over HTTP. This is the same wire protocol Home
Assistant's Wyoming integration uses.
"""
from __future__ import annotations

import asyncio
import io
import struct
import wave
from functools import partial

import pytest
from aiohttp import web
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.client import AsyncTcpClient
from wyoming.error import Error
from wyoming.handle import Handled, NotHandled
from wyoming.info import Describe, Info
from wyoming.server import AsyncTcpServer
from wyoming.tts import Synthesize, SynthesizeVoice

from src.client.ci_client import CIClient
from src.config import BridgeConfig
from src.conversation import ConversationStore
from src.wyoming.handler import CompanionEventHandler
from src.wyoming.info import build_info

API_KEY = "test-key"


def _wav(num_samples: int = 2400, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(struct.pack(f"<{num_samples}h", *([500] * num_samples)))
    return buf.getvalue()


class FakeCIServer:
    """Records what the bridge sent and answers like ci-server would."""

    def __init__(self) -> None:
        self.transcriptions: list[dict] = []
        self.responses: list[dict] = []
        self.speech: list[dict] = []
        self.fail_responses = False
        self.speech_body: bytes = _wav()

    def _authorized(self, request: web.Request) -> bool:
        return request.headers.get("Authorization") == f"Bearer {API_KEY}"

    async def transcriptions_handler(self, request: web.Request) -> web.Response:
        if not self._authorized(request):
            return web.json_response({"error": {"code": "invalid_api_key"}}, status=401)
        form = await request.post()
        upload = form["file"]
        audio = upload.file.read()
        with wave.open(io.BytesIO(audio), "rb") as wf:
            fmt = (wf.getframerate(), wf.getsampwidth(), wf.getnchannels(), wf.getnframes())
        self.transcriptions.append({"model": form["model"], "language": form.get("language"), "fmt": fmt})
        return web.json_response({"text": " turn on the kitchen lights "})

    async def responses_handler(self, request: web.Request) -> web.Response:
        if not self._authorized(request):
            return web.json_response({"error": {"code": "invalid_api_key"}}, status=401)
        body = await request.json()
        self.responses.append(body)
        if self.fail_responses:
            return web.json_response({"error": {"code": "upstream_error"}}, status=502)
        turn = len(self.responses)
        return web.json_response(
            {
                "id": f"resp_{turn}",
                "object": "response",
                "status": "completed",
                "output": [
                    {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": f"Answer {turn}."}]}
                ],
            }
        )

    async def speech_handler(self, request: web.Request) -> web.Response:
        if not self._authorized(request):
            return web.json_response({"error": {"code": "invalid_api_key"}}, status=401)
        self.speech.append(await request.json())
        return web.Response(body=self.speech_body, content_type="audio/wav")

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/v1/audio/transcriptions", self.transcriptions_handler)
        app.router.add_post("/v1/responses", self.responses_handler)
        app.router.add_post("/v1/audio/speech", self.speech_handler)
        return app


@pytest.fixture
async def stack(unused_tcp_port_factory):
    fake = FakeCIServer()
    runner = web.AppRunner(fake.app())
    await runner.setup()
    http_port = unused_tcp_port_factory()
    await web.TCPSite(runner, "127.0.0.1", http_port).start()

    config = BridgeConfig.from_env(
        {
            "CI_SERVER_URL": f"http://127.0.0.1:{http_port}",
            "CI_SERVER_API_KEY": API_KEY,
            "CI_MODEL": "ollama:test",
            "CI_TTS_VOICES": "alloy,nova",
        }
    )
    client = CIClient(config)
    wyoming_port = unused_tcp_port_factory()
    server = AsyncTcpServer("127.0.0.1", wyoming_port)
    await server.start(
        partial(CompanionEventHandler, build_info(config), config, client, ConversationStore())
    )

    def connect() -> AsyncTcpClient:
        return AsyncTcpClient("127.0.0.1", wyoming_port, connect_timeout=5, read_timeout=5)

    yield fake, connect
    await server.stop()
    await client.close()
    await runner.cleanup()


async def _read(client: AsyncTcpClient):
    event = await asyncio.wait_for(client.read_event(), timeout=5)
    assert event is not None, "bridge closed the connection"
    return event


async def test_describe_returns_info(stack):
    _, connect = stack
    async with connect() as client:
        await client.write_event(Describe().event())
        info = Info.from_event(await _read(client))
    assert info.asr and info.tts and info.handle
    assert [v.name for v in info.tts[0].voices] == ["alloy", "nova"]


async def test_speech_to_text_resamples_and_transcribes(stack):
    fake, connect = stack
    # HA may stream 48 kHz stereo; the bridge must upload 16 kHz mono.
    stereo_48k = struct.pack("<1920h", *([800] * 1920))  # 960 frames x 2 channels = 20 ms
    async with connect() as client:
        await client.write_event(Transcribe(language="en").event())
        await client.write_event(AudioStart(rate=48000, width=2, channels=2).event())
        for _ in range(10):
            await client.write_event(AudioChunk(rate=48000, width=2, channels=2, audio=stereo_48k).event())
        await client.write_event(AudioStop().event())
        transcript = Transcript.from_event(await _read(client))

    assert transcript.text == "turn on the kitchen lights"
    assert transcript.language == "en"
    rate, width, channels, frames = fake.transcriptions[0]["fmt"]
    assert (rate, width, channels) == (16000, 2, 1)
    assert 3100 <= frames <= 3300  # ~200 ms at 16 kHz
    assert fake.transcriptions[0]["model"] == "whisper-1"


async def test_conversation_keeps_context_between_turns(stack):
    fake, connect = stack
    async with connect() as client:
        await client.write_event(Transcript(text="What is on my calendar?", context={"conversation_id": "c1"}).event())
        first = Handled.from_event(await _read(client))
    async with connect() as client:
        await client.write_event(Transcript(text="And tomorrow?", context={"conversation_id": "c1"}).event())
        second = Handled.from_event(await _read(client))

    assert first.text == "Answer 1."
    assert second.text == "Answer 2."
    assert second.context == {"conversation_id": "c1"}
    assert fake.responses[1]["input"] == [
        {"role": "user", "content": "What is on my calendar?"},
        {"role": "assistant", "content": "Answer 1."},
        {"role": "user", "content": "And tomorrow?"},
    ]
    assert fake.responses[0]["model"] == "ollama:test"
    assert fake.responses[0]["metadata"] == {"session_id": "c1", "platform": "ha-voice-pe"}
    assert "concise" in fake.responses[0]["instructions"]


async def test_conversation_failure_is_not_handled(stack):
    fake, connect = stack
    fake.fail_responses = True
    async with connect() as client:
        await client.write_event(Transcript(text="hello").event())
        event = await _read(client)
    assert NotHandled.is_type(event.type)
    assert "could not reach" in NotHandled.from_event(event).text


async def test_text_to_speech_streams_audio(stack):
    fake, connect = stack
    async with connect() as client:
        await client.write_event(Synthesize(text="Lights on.", voice=SynthesizeVoice(name="nova")).event())
        start = AudioStart.from_event(await _read(client))
        pcm = b""
        while True:
            event = await _read(client)
            if AudioStop.is_type(event.type):
                break
            pcm += AudioChunk.from_event(event).audio

    assert (start.rate, start.width, start.channels) == (24000, 2, 1)
    assert len(pcm) == 2400 * 2
    assert fake.speech[0] == {"model": "tts-1", "input": "Lights on.", "voice": "nova", "response_format": "wav"}


async def test_text_to_speech_rejects_non_wav(stack):
    fake, connect = stack
    fake.speech_body = b"ID3" + b"\x00" * 100
    async with connect() as client:
        await client.write_event(Synthesize(text="hi").event())
        event = await _read(client)
    assert Error.is_type(event.type)
    assert "not WAV" in Error.from_event(event).text
