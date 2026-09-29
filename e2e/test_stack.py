"""
Whole-stack test: the real ci-server (built JavaScript) and the real voice
bridge run as separate processes, wired together exactly like docker-compose
does. Ollama, the speech server and Companion Memory are stubbed with a small
aiohttp app. A Wyoming client plays the part of Home Assistant.

Run from the repo root after `npm --prefix ci-server run build`:
    python -m pytest e2e -q

Without ci-server/dist the suite is skipped, unless REQUIRE_E2E or CI is set
(scripts/test-all.sh and the stack-e2e job set it), where a missing build is a
failure: a skipped whole-stack test must never read as a green one.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import socket
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

import pytest
from aiohttp import ClientSession, ClientTimeout, web
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.client import AsyncTcpClient
from wyoming.handle import Handled
from wyoming.info import Describe, Info
from wyoming.tts import Synthesize

ROOT = Path(__file__).resolve().parent.parent
MASTER_KEY = "e2e-master-key"
MEMORY_KEY = "e2e-memory-key"
FROZEN = json.loads((ROOT / "contracts" / "frozen-surfaces.json").read_text())


def env_flag(name: str) -> bool:
    """True when the variable is set to anything but an empty or false-like value."""
    return os.environ.get(name, "").strip().lower() not in ("", "0", "false", "no", "off")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wav_bytes(samples: int = 1600, rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(struct.pack(f"<{samples}h", *([300] * samples)))
    return buf.getvalue()


class Upstreams:
    """Ollama + speaches + Companion Memory, all on one port."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    async def chat(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.calls.append(("chat", body))
        return web.json_response(
            {
                "id": "chatcmpl_e2e",
                "model": body["model"],
                "choices": [{"message": {"role": "assistant", "content": "The kitchen lights are on."}, "finish_reason": "stop"}],
            }
        )

    async def models(self, _request: web.Request) -> web.Response:
        return web.json_response({"data": [{"id": "llama3.2", "object": "model"}]})

    async def transcribe(self, request: web.Request) -> web.Response:
        form = await request.post()
        self.calls.append(("stt", {"model": form["model"], "language": form.get("language")}))
        return web.json_response({"text": "turn on the kitchen lights"})

    async def speech(self, request: web.Request) -> web.Response:
        self.calls.append(("tts", await request.json()))
        return web.Response(body=wav_bytes(), content_type="audio/wav")

    async def memory(self, request: web.Request) -> web.Response:
        if request.headers.get("x-api-key") != MEMORY_KEY:
            return web.json_response({"message": "Unauthorized"}, status=401)
        name = request.match_info["name"]
        body = await request.json() if request.method == "POST" else None
        self.calls.append((f"memory.{name}", body))
        if name == "context":
            return web.json_response({"block": "<profile>Prefers warm light</profile>"})
        if name == "recall":
            return web.json_response({"block": "<recall>Kitchen uses the Hue group</recall>", "resultCount": 1})
        return web.json_response({"created": 2, "skipped": 0})

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/v1/chat/completions", self.chat)
        app.router.add_get("/v1/models", self.models)
        app.router.add_post("/v1/audio/transcriptions", self.transcribe)
        app.router.add_post("/v1/audio/speech", self.speech)
        app.router.add_route("*", "/memory/{name}", self.memory)
        return app

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


async def wait_for_port(port: int, proc: subprocess.Popen, timeout: float = 20) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"process exited early with {proc.returncode}")
        try:
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.close()
            return
        except OSError:
            await asyncio.sleep(0.1)
    raise TimeoutError(f"port {port} never opened")


@pytest.fixture
async def stack():
    dist = ROOT / "ci-server" / "dist" / "index.js"
    if not dist.exists():
        message = "build ci-server first: npm --prefix ci-server run build"
        if env_flag("REQUIRE_E2E") or env_flag("CI"):
            pytest.fail(message, pytrace=False)
        pytest.skip(message)

    upstreams = Upstreams()
    runner = web.AppRunner(upstreams.app())
    await runner.setup()
    upstream_port = free_port()
    await web.TCPSite(runner, "127.0.0.1", upstream_port).start()
    upstream_url = f"http://127.0.0.1:{upstream_port}"

    server_port, bridge_port = free_port(), free_port()
    base_env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "SYSTEMROOT")}
    server = subprocess.Popen(
        ["node", str(dist)],
        cwd=ROOT / "ci-server",
        env={
            **base_env,
            "NODE_ENV": "production",
            "PORT": str(server_port),
            "MASTER_API_KEY": MASTER_KEY,
            "OLLAMA_BASE_URL": upstream_url,
            "CI_MODEL": "ollama:llama3.2",
            "STT_BASE_URL": upstream_url,
            "STT_MODEL": "Systran/faster-distil-whisper-small.en",
            "TTS_BASE_URL": upstream_url,
            "TTS_MODEL": "speaches-ai/Kokoro-82M-v1.0-ONNX",
            "CI_MEMORY_URL": upstream_url,
            "CI_MEMORY_API_KEY": MEMORY_KEY,
            # Unreachable on purpose: the facade must not need them to serve voice.
            "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none",
            "REDIS_URL": "redis://127.0.0.1:1",
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    bridge = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=ROOT / "voice-bridge",
        env={
            **base_env,
            "CI_SERVER_URL": f"http://127.0.0.1:{server_port}",
            "CI_SERVER_API_KEY": MASTER_KEY,
            "CI_MODEL": "ollama:llama3.2",
            "CI_TTS_VOICE": "af_heart",
            "VOICE_BRIDGE_HOST": "127.0.0.1",
            "VOICE_BRIDGE_PORT": str(bridge_port),
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        await wait_for_port(server_port, server)
        await wait_for_port(bridge_port, bridge)
        yield upstreams, bridge_port, server_port
    finally:
        for proc in (bridge, server):
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        await runner.cleanup()


async def read(client: AsyncTcpClient):
    event = await asyncio.wait_for(client.read_event(), timeout=10)
    assert event is not None
    return event


async def test_home_assistant_round_trip(stack):
    upstreams, bridge_port, _ = stack

    def connect() -> AsyncTcpClient:
        return AsyncTcpClient("127.0.0.1", bridge_port, connect_timeout=5)

    # 1. HA adds the integration: describe
    async with connect() as client:
        await client.write_event(Describe().event())
        info = Info.from_event(await read(client))
    assert info.asr[0].name == "companion-stt"
    assert info.tts[0].voices[0].name == "af_heart"
    assert info.handle[0].name == "companion-conversation"

    # 2. Speech-to-text
    pcm = struct.pack("<320h", *([900] * 320))
    async with connect() as client:
        await client.write_event(Transcribe(language="en").event())
        await client.write_event(AudioStart(rate=16000, width=2, channels=1).event())
        for _ in range(25):
            await client.write_event(AudioChunk(rate=16000, width=2, channels=1, audio=pcm).event())
        await client.write_event(AudioStop().event())
        transcript = Transcript.from_event(await read(client))
    assert transcript.text == "turn on the kitchen lights"

    # 3. Conversation, grounded in Companion Memory
    async with connect() as client:
        await client.write_event(
            Transcript(text=transcript.text, context={"conversation_id": "ha-conv-1"}).event()
        )
        handled = Handled.from_event(await read(client))
    assert handled.text == "The kitchen lights are on."

    # 4. Text-to-speech
    async with connect() as client:
        await client.write_event(Synthesize(text=handled.text).event())
        start = AudioStart.from_event(await read(client))
        total = 0
        while True:
            event = await read(client)
            if AudioStop.is_type(event.type):
                break
            total += len(AudioChunk.from_event(event).audio)
    assert start.rate == 22050
    assert total == 1600 * 2

    # What reached the upstreams
    stt = dict(upstreams.calls)["stt"]
    assert stt == {"model": "Systran/faster-distil-whisper-small.en", "language": "en"}

    chat = dict(upstreams.calls)["chat"]
    assert chat["model"] == "llama3.2"
    system = "\n".join(m["content"] for m in chat["messages"] if m["role"] == "system")
    assert "concise smart home voice assistant" in system
    assert "Prefers warm light" in system and "Kitchen uses the Hue group" in system

    tts = dict(upstreams.calls)["tts"]
    assert tts["model"] == "speaches-ai/Kokoro-82M-v1.0-ONNX"
    assert tts["voice"] == "af_heart"
    assert tts["response_format"] == "wav"

    deadline = time.monotonic() + 5
    while "memory.turn" not in upstreams.names() and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    turn = dict(upstreams.calls)["memory.turn"]
    assert turn == {
        "messages": [
            {"role": "user", "content": "turn on the kitchen lights"},
            {"role": "assistant", "content": "The kitchen lights are on."},
        ],
        "sessionId": "ha-conv-1",
        "platform": "ha-voice-pe",
    }


async def test_status_key_set_is_frozen(stack):
    """
    GET /v1/status is read by the ha.ci.computer checker. The top-level key set
    is exactly the frozen list, and each nested object keeps its required keys
    and adds nothing outside the frozen optional ones. contracts/frozen-surfaces.json
    holds the list; changing it is a deliberate edit of both files.
    """
    _, _, server_port = stack
    spec = FROZEN["status"]
    async with ClientSession() as session:
        async with session.get(
            f"http://127.0.0.1:{server_port}{spec['path']}",
            headers={"Authorization": f"Bearer {MASTER_KEY}"},
            timeout=ClientTimeout(total=10),
        ) as response:
            assert response.status == 200
            body = await response.json()

    assert sorted(body) == sorted(spec["fields"])
    for name, nested in spec["nested"].items():
        keys = set(body[name])
        allowed = set(nested["required"]) | set(nested["optional"])
        assert set(nested["required"]) <= keys, f"{name} lost {set(nested['required']) - keys}"
        assert keys <= allowed, f"{name} gained {keys - allowed}"
