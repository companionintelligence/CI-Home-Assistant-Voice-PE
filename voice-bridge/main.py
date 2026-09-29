"""
Voice Bridge entry point.

Runs a Wyoming TCP server that Home Assistant adds through its Wyoming
integration (Settings > Devices & services > Add integration > Wyoming Protocol,
host = this machine, port = 10700). It offers three services backed by
ci-server: speech-to-text, text-to-speech and a conversation agent.

Usage:
  CI_SERVER_URL=http://localhost:8080 CI_SERVER_API_KEY=<key> python main.py
"""
from __future__ import annotations

import asyncio
import logging
from functools import partial

from wyoming.server import AsyncTcpServer

from src.client.ci_client import CIClient
from src.config import BridgeConfig, debug_enabled
from src.conversation import ConversationStore
from src.wyoming.handler import CompanionEventHandler
from src.wyoming.info import build_info

logging.basicConfig(
    level=logging.DEBUG if debug_enabled() else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice-bridge")


async def _register_zeroconf(config: BridgeConfig) -> None:
    try:
        from wyoming.zeroconf import HomeAssistantZeroconf
    except ImportError:
        logger.warning("WYOMING_ZEROCONF is on but the zeroconf package is not installed")
        return
    await HomeAssistantZeroconf(name=config.zeroconf_name, port=config.port).register_server()
    logger.info("Advertised to Home Assistant over mDNS as %s", config.zeroconf_name)


async def main() -> None:
    config = BridgeConfig.from_env()
    client = CIClient(config)
    conversations = ConversationStore(max_turns=config.history_turns, ttl_s=config.history_ttl_s)
    info = build_info(config)

    server = AsyncTcpServer(config.host, config.port)
    logger.info(
        "Voice Bridge listening on tcp://%s:%d (ci-server %s, model %s)",
        config.host,
        config.port,
        config.ci_server_url,
        config.model,
    )
    if config.zeroconf:
        await _register_zeroconf(config)
    try:
        await server.run(partial(CompanionEventHandler, info, config, client, conversations))
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
