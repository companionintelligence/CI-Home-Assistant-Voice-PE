"""conftest.py – add the voice-bridge parent directory to sys.path."""
import sys
import os

# Allow "from voice_bridge.src.xxx import ..." style imports
# by pointing Python at the directory containing 'voice-bridge'
# We use the directory containing main.py as a base
BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BRIDGE_DIR)

# voice-bridge dir is a package named via its __init__.py; add its parent
# to sys.path so "import voice_bridge" would work if we named things correctly.
# Instead, add voice-bridge itself so "from src.xxx import ..." works.
if BRIDGE_DIR not in sys.path:
    sys.path.insert(0, BRIDGE_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


# ---------------------------------------------------------------- fixtures
#
# The bridge behind a real Wyoming TCP server, talking to a FakeCIServer that
# can fail on any route (see harness.py). `bridge_stack` is a factory so a test
# can build a second stack, for instance one pointed at a dead ci-server.
# These imports sit below the sys.path setup above on purpose.

import asyncio
from functools import partial

import pytest
from aiohttp import web
from wyoming.server import AsyncTcpServer

from src.client.ci_client import CIClient
from src.config import BridgeConfig
from src.conversation import ConversationStore
from src.wyoming.handler import CompanionEventHandler
from src.wyoming.info import build_info

from .harness import API_KEY, FakeCIServer, LoopErrors, Stack


@pytest.fixture
async def loop_errors():
    return LoopErrors(asyncio.get_running_loop())


@pytest.fixture
async def bridge_stack(unused_tcp_port_factory, loop_errors):
    cleanups = []

    async def build(env: dict[str, str] | None = None, ci_url: str | None = None) -> Stack:
        fake = FakeCIServer()
        runner = web.AppRunner(fake.app())
        await runner.setup()
        http_port = unused_tcp_port_factory()
        await web.TCPSite(runner, "127.0.0.1", http_port).start()

        config = BridgeConfig.from_env(
            {
                "CI_SERVER_URL": ci_url or f"http://127.0.0.1:{http_port}",
                "CI_SERVER_API_KEY": API_KEY,
                "CI_MODEL": "ollama:test",
                "CI_TTS_VOICES": "alloy,nova",
                "CI_REQUEST_TIMEOUT_S": "5",
                **(env or {}),
            }
        )
        client = CIClient(config)
        conversations = ConversationStore()
        wyoming_port = unused_tcp_port_factory()
        server = AsyncTcpServer("127.0.0.1", wyoming_port)
        await server.start(partial(CompanionEventHandler, build_info(config), config, client, conversations))

        async def cleanup() -> None:
            fake.release()
            await server.stop()
            await client.close()
            await runner.cleanup()

        cleanups.append(cleanup)
        return Stack(
            fake=fake,
            config=config,
            client=client,
            conversations=conversations,
            server=server,
            wyoming_port=wyoming_port,
        )

    yield build

    for cleanup in reversed(cleanups):
        await cleanup()
    # A handler task that died with an exception only reports it once it is collected.
    await loop_errors.settle()
    assert not loop_errors.items, f"unhandled task exceptions: {loop_errors.describe()}"


@pytest.fixture
async def bridge(bridge_stack):
    return await bridge_stack()
