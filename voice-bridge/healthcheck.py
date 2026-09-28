"""Container healthcheck: ask the bridge to describe itself over Wyoming."""
import asyncio
import os
import sys

from wyoming.client import AsyncTcpClient
from wyoming.info import Describe, Info


async def check() -> bool:
    port = int(os.environ.get("VOICE_BRIDGE_PORT", "10700"))
    async with AsyncTcpClient("127.0.0.1", port, connect_timeout=3, read_timeout=3) as client:
        await client.write_event(Describe().event())
        event = await client.read_event()
    return event is not None and Info.is_type(event.type)


if __name__ == "__main__":
    try:
        sys.exit(0 if asyncio.run(check()) else 1)
    except Exception:  # noqa: BLE001
        sys.exit(1)
