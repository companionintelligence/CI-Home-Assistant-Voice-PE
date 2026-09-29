#!/usr/bin/env python3
"""
Helper for scripts/voice-container-smoke.sh, which owns every process and the
container. Three subcommands:

  free-ports N   print N distinct free TCP ports, one per line
  stubs          serve the Ollama, speech and Companion Memory stubs
  drive          drive a running Home Assistant container: onboarding, add the
                 core wyoming integration, check the three entities, run one
                 conversation and check what reached the stubs

The stubs are the same ones e2e/test_stack.py uses, plus a JSON lines call log
that the drive step reads back. Needs aiohttp only.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import socket
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from aiohttp import ClientError, ClientSession, ClientTimeout, web

# Test-only constants, shared with the shell script through arguments and env.
MASTER_KEY = "smoke-master-key"
MEMORY_KEY = "smoke-memory-key"
ANSWER = "The kitchen lights are on, from the smoke test stub."
QUESTION = "turn on the kitchen lights"
EXPECTED_ENTITIES = {
    "stt": "companion-stt",
    "tts": "companion-tts",
    "conversation": "companion-conversation",
}


class SmokeError(Exception):
    """A failed assertion or an unexpected answer, reported as one FAILED line."""


def free_ports(count: int) -> list[int]:
    sockets = [socket.socket() for _ in range(count)]
    try:
        for s in sockets:
            s.bind(("127.0.0.1", 0))
        return [s.getsockname()[1] for s in sockets]
    finally:
        for s in sockets:
            s.close()


def wav_bytes(samples: int = 1600, rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(struct.pack(f"<{samples}h", *([300] * samples)))
    return buf.getvalue()


class Upstreams:
    """Ollama + speaches + Companion Memory, all on one port. Every call is logged to a file."""

    def __init__(self, calls_file: Path) -> None:
        self.calls_file = calls_file

    def record(self, name: str, body: object) -> None:
        with self.calls_file.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"name": name, "body": body}) + "\n")

    async def chat(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.record("chat", body)
        return web.json_response(
            {
                "id": "chatcmpl_smoke",
                "model": body["model"],
                "choices": [{"message": {"role": "assistant", "content": ANSWER}, "finish_reason": "stop"}],
            }
        )

    async def models(self, _request: web.Request) -> web.Response:
        return web.json_response({"data": [{"id": "llama3.2", "object": "model"}]})

    async def transcribe(self, request: web.Request) -> web.Response:
        form = await request.post()
        self.record("stt", {"model": form["model"], "language": form.get("language")})
        return web.json_response({"text": QUESTION})

    async def speech(self, request: web.Request) -> web.Response:
        self.record("tts", await request.json())
        return web.Response(body=wav_bytes(), content_type="audio/wav")

    async def memory(self, request: web.Request) -> web.Response:
        if request.headers.get("x-api-key") != MEMORY_KEY:
            return web.json_response({"message": "Unauthorized"}, status=401)
        name = request.match_info["name"]
        body = await request.json() if request.method == "POST" else None
        self.record(f"memory.{name}", body)
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


async def serve_stubs(port: int, calls_file: Path) -> None:
    calls_file.write_text("", encoding="utf-8")
    runner = web.AppRunner(Upstreams(calls_file).app())
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    print(f"stubs listening on 127.0.0.1:{port}", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def read_calls(calls_file: Path) -> list[dict[str, Any]]:
    lines = calls_file.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


class HomeAssistant:
    """Just enough of the Home Assistant REST and WebSocket API for this check."""

    def __init__(self, session: ClientSession, base: str) -> None:
        self.session = session
        self.base = base.rstrip("/")
        self.token: str | None = None

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        form: dict[str, str] | None = None,
        timeout: float = 30,
    ) -> tuple[int, Any]:
        headers: dict[str, str] = {}
        data: str | None = None
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if form is not None:
            data = urlencode(form)
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body)
            headers["Content-Type"] = "application/json"
        async with self.session.request(
            method, self.base + path, data=data, headers=headers, timeout=ClientTimeout(total=timeout)
        ) as response:
            text = await response.text()
            try:
                return response.status, json.loads(text) if text else None
            except json.JSONDecodeError:
                return response.status, text[:300]

    async def ok(self, method: str, path: str, what: str, **kwargs: Any) -> Any:
        status, body = await self.request(method, path, **kwargs)
        if status != 200:
            raise SmokeError(f"{what}: {method} {path} answered {status}: {str(body)[:300]}")
        return body

    async def websocket(self, payload: dict[str, Any]) -> Any:
        url = self.base.replace("http", "ws", 1) + "/api/websocket"
        async with self.session.ws_connect(url, timeout=30) as ws:
            first = await ws.receive_json(timeout=30)
            if first.get("type") != "auth_required":
                raise SmokeError(f"websocket: expected auth_required, got {first}")
            await ws.send_json({"type": "auth", "access_token": self.token})
            second = await ws.receive_json(timeout=30)
            if second.get("type") != "auth_ok":
                raise SmokeError(f"websocket: auth failed: {second}")
            await ws.send_json({"id": 1, **payload})
            while True:
                message = await ws.receive_json(timeout=30)
                if message.get("id") == 1:
                    if not message.get("success", False):
                        raise SmokeError(f"websocket {payload['type']} failed: {message.get('error')}")
                    return message["result"]


def container_running(name: str) -> bool:
    result = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", name],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


async def wait_for_home_assistant(ha: HomeAssistant, container: str, timeout: float) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while True:
        if not container_running(container):
            raise SmokeError(f"container {container} stopped before Home Assistant answered")
        try:
            status, body = await ha.request("GET", "/api/onboarding", timeout=5)
            if status == 200 and isinstance(body, list):
                return body
        except (ClientError, asyncio.TimeoutError, OSError):
            pass
        if time.monotonic() > deadline:
            raise SmokeError(f"Home Assistant did not answer within {timeout:.0f}s")
        await asyncio.sleep(2)


async def wait_until_running(ha: HomeAssistant, container: str, timeout: float) -> dict[str, Any]:
    """The HTTP server answers well before the configured integrations have loaded."""
    deadline = time.monotonic() + timeout
    state = "unknown"
    while time.monotonic() < deadline:
        if not container_running(container):
            raise SmokeError(f"container {container} stopped while Home Assistant was starting")
        config = await ha.ok("GET", "/api/config", "read config")
        state = config.get("state", "unknown")
        if state == "RUNNING":
            return config
        await asyncio.sleep(2)
    raise SmokeError(f"Home Assistant state is {state!r}, not RUNNING, after {timeout:.0f}s")


async def complete_onboarding(ha: HomeAssistant, steps: list[dict[str, Any]]) -> None:
    done = {item["step"]: item["done"] for item in steps}
    if done.get("user"):
        raise SmokeError(f"expected a fresh Home Assistant, onboarding already has a user: {done}")
    client_id = ha.base + "/"
    created = await ha.ok(
        "POST",
        "/api/onboarding/users",
        "create owner",
        body={
            "client_id": client_id,
            "name": "Smoke",
            "username": "smoke",
            "password": "smoke-test-pass-12345",
            "language": "en",
        },
    )
    tokens = await ha.ok(
        "POST",
        "/auth/token",
        "exchange auth code",
        form={"grant_type": "authorization_code", "code": created["auth_code"], "client_id": client_id},
    )
    ha.token = tokens["access_token"]
    await ha.ok("POST", "/api/onboarding/core_config", "onboarding core_config", body={})
    await ha.ok("POST", "/api/onboarding/analytics", "onboarding analytics", body={})
    await ha.ok(
        "POST",
        "/api/onboarding/integration",
        "onboarding integration",
        body={"client_id": client_id, "redirect_uri": client_id},
    )
    remaining = [item["step"] for item in await ha.ok("GET", "/api/onboarding", "onboarding status") if not item["done"]]
    if remaining:
        raise SmokeError(f"onboarding steps still open: {remaining}")


async def add_wyoming(ha: HomeAssistant, host: str, port: int) -> dict[str, Any]:
    flow = await ha.ok(
        "POST",
        "/api/config/config_entries/flow",
        "start wyoming config flow",
        body={"handler": "wyoming", "show_advanced_options": False},
    )
    if flow.get("type") != "form" or flow.get("step_id") != "user":
        raise SmokeError(f"wyoming flow did not open on the user form: {flow}")
    # The flow sends Describe to the bridge and retries three times when it cannot connect.
    result = await ha.ok(
        "POST",
        f"/api/config/config_entries/flow/{flow['flow_id']}",
        "submit wyoming host and port",
        body={"host": host, "port": port},
        timeout=90,
    )
    if result.get("type") != "create_entry":
        raise SmokeError(f"wyoming flow did not create an entry: {result}")
    return result


async def wait_for_entry_loaded(ha: HomeAssistant, entry_id: str, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    state = "missing"
    while time.monotonic() < deadline:
        entries = await ha.ok("GET", "/api/config/config_entries/entry?domain=wyoming", "list wyoming entries")
        state = next((e["state"] for e in entries if e["entry_id"] == entry_id), "missing")
        if state == "loaded":
            return
        await asyncio.sleep(1)
    raise SmokeError(f"wyoming entry {entry_id} is {state!r}, not loaded, after {timeout:.0f}s")


async def find_entities(ha: HomeAssistant, entry_id: str) -> dict[str, dict[str, Any]]:
    registry = await ha.websocket({"type": "config/entity_registry/list"})
    ours = [e for e in registry if e.get("config_entry_id") == entry_id and e.get("platform") == "wyoming"]
    found: dict[str, dict[str, Any]] = {}
    for domain, program in EXPECTED_ENTITIES.items():
        matches = [
            e for e in ours if e["entity_id"].split(".", 1)[0] == domain and e.get("original_name") == program
        ]
        if len(matches) != 1:
            listed = sorted(e["entity_id"] for e in ours)
            raise SmokeError(
                f"expected one {domain} entity named {program!r} on the wyoming entry, "
                f"found {len(matches)}; entry entities: {listed}"
            )
        found[domain] = matches[0]
    extra = sorted(e["entity_id"] for e in ours if e["entity_id"] not in {f["entity_id"] for f in found.values()})
    if extra:
        raise SmokeError(f"the wyoming entry has entities beyond the three programs: {extra}")
    for domain, entity in found.items():
        state = await ha.ok("GET", f"/api/states/{entity['entity_id']}", f"state of {entity['entity_id']}")
        if state["state"] == "unavailable":
            raise SmokeError(f"{entity['entity_id']} is unavailable")
        entity["state"] = state["state"]
    return found


async def converse(ha: HomeAssistant, agent_id: str) -> dict[str, Any]:
    body = await ha.ok(
        "POST",
        "/api/conversation/process",
        "conversation/process",
        body={"text": QUESTION, "language": "en", "agent_id": agent_id},
        timeout=60,
    )
    response = body.get("response", {})
    speech = response.get("speech", {}).get("plain", {}).get("speech")
    if response.get("response_type") == "error" or speech != ANSWER:
        raise SmokeError(f"unexpected conversation answer: expected {ANSWER!r}, got {json.dumps(body)[:400]}")
    return body


async def check_stub_calls(calls_file: Path, conversation_id: str | None) -> list[str]:
    # The memory turn is saved after the reply, so give it a moment.
    deadline = time.monotonic() + 10
    while True:
        calls = read_calls(calls_file)
        names = [c["name"] for c in calls]
        if "memory.turn" in names or time.monotonic() > deadline:
            break
        await asyncio.sleep(0.2)
    chat = next((c["body"] for c in calls if c["name"] == "chat"), None)
    if chat is None:
        raise SmokeError(f"the model stub never saw a chat request; stub calls: {names}")
    users = [m["content"] for m in chat["messages"] if m["role"] == "user"]
    if QUESTION not in users:
        raise SmokeError(f"the chat request did not carry the question: {users}")
    turn = next((c["body"] for c in calls if c["name"] == "memory.turn"), None)
    if turn is None:
        raise SmokeError(f"no memory turn reached the Companion Memory stub; stub calls: {names}")
    if turn.get("platform") != "ha-voice-pe":
        raise SmokeError(f"memory turn platform is {turn.get('platform')!r}, not 'ha-voice-pe'")
    if conversation_id and turn.get("sessionId") != conversation_id:
        raise SmokeError(
            f"memory turn sessionId {turn.get('sessionId')!r} is not the Home Assistant conversation id {conversation_id!r}"
        )
    return names


async def drive(args: argparse.Namespace) -> int:
    timings: dict[str, float] = {}
    mark = time.monotonic()

    def lap(name: str) -> None:
        nonlocal mark
        now = time.monotonic()
        timings[name] = now - mark
        mark = now

    async with ClientSession() as session:
        ha = HomeAssistant(session, args.base_url)
        try:
            steps = await wait_for_home_assistant(ha, args.container, args.boot_timeout)
            lap("ha_boot")
            print(f"Home Assistant answered, onboarding steps: {[(s['step'], s['done']) for s in steps]}")

            await complete_onboarding(ha, steps)
            lap("onboarding")

            config = await wait_until_running(ha, args.container, args.boot_timeout)
            lap("ha_running")
            print(f"Home Assistant version: {config['version']}")
            if config["version"] != args.expect_version:
                raise SmokeError(f"expected Home Assistant {args.expect_version}, the container reports {config['version']}")
            missing = [c for c in ("conversation", "stt", "tts") if c not in config["components"]]
            if missing:
                raise SmokeError(f"configuration.yaml components did not load: {missing}")

            created = await add_wyoming(ha, args.bridge_host, args.bridge_port)
            entry_id = created["result"]["entry_id"]
            print(f"wyoming config entry {entry_id} created, title {created.get('title')!r}")
            await wait_for_entry_loaded(ha, entry_id)
            lap("add_wyoming")

            entities = await find_entities(ha, entry_id)
            for domain in EXPECTED_ENTITIES:
                entity = entities[domain]
                print(f"entity {entity['entity_id']} ({domain}, {entity['original_name']}), state {entity['state']}")
            lap("entities")

            answer = await converse(ha, entities["conversation"]["entity_id"])
            conversation_id = answer.get("conversation_id")
            print(f"conversation answered: {ANSWER!r}, conversation_id {conversation_id}")
            calls = await check_stub_calls(args.calls_file, conversation_id)
            print(f"stub calls: {calls}")
            lap("conversation")
        except SmokeError as err:
            print(f"FAILED: {err}", file=sys.stderr)
            return 1
        except (ClientError, asyncio.TimeoutError, OSError, KeyError) as err:
            print(f"FAILED: {type(err).__name__}: {err}", file=sys.stderr)
            return 1

    print("timings: " + ", ".join(f"{name} {seconds:.1f}s" for name, seconds in timings.items()))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    ports = sub.add_parser("free-ports")
    ports.add_argument("count", type=int)

    stubs = sub.add_parser("stubs")
    stubs.add_argument("--port", type=int, required=True)
    stubs.add_argument("--calls-file", type=Path, required=True)

    run = sub.add_parser("drive")
    run.add_argument("--base-url", required=True, help="Home Assistant as seen from the host")
    run.add_argument("--container", required=True, help="container name, watched so a crash fails fast")
    run.add_argument("--bridge-host", required=True, help="bridge as seen from the container")
    run.add_argument("--bridge-port", type=int, required=True)
    run.add_argument("--calls-file", type=Path, required=True)
    run.add_argument("--expect-version", required=True)
    run.add_argument("--boot-timeout", type=float, default=300)

    args = parser.parse_args()
    if args.command == "free-ports":
        print("\n".join(str(p) for p in free_ports(args.count)))
        return 0
    if args.command == "stubs":
        asyncio.run(serve_stubs(args.port, args.calls_file))
        return 0
    return asyncio.run(drive(args))


if __name__ == "__main__":
    sys.exit(main())
