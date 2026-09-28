# CLAUDE.md — CI-Home-Assistant-Voice-PE

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

## Platform role

**CI-Home-Assistant-Voice-PE** sits in the **Integration** layer of the Companion Intelligence platform.

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`
Issues: <https://github.com/companionintelligence/CI-Engineering/issues>

## What this repo does

Home Assistant Voice PE integration for Companion Intelligence — voice pipeline extension.

## Stack

- `voice-bridge/`: Python 3.12, asyncio, `wyoming` (Wyoming TCP server for Home Assistant)
- `ci-server/`: Node 20, TypeScript, Express (OpenAI-compatible facade)
- `web/`: static site for https://ha.ci.computer, deployed as a Cloudflare Worker with wrangler
- Docker Compose for the full stack

## Key commands

```bash
# Everything, the way CI runs it
scripts/test-all.sh

# voice-bridge
cd voice-bridge && pip install -r requirements.txt -r requirements-dev.txt && python -m pytest

# ci-server
cd ci-server && npm ci && npm run typecheck && npm test && npm run build

# whole stack (needs ci-server/dist)
python -m pytest e2e

# setup site
cd web && npm ci && npm test && npm run check   # check = wrangler dry run

# run the stack
docker compose up -d
```

## Package managers

**pip** for `voice-bridge/`, **npm** for `ci-server/` and `web/` (each has its own
lockfile). Do not introduce yarn, pnpm or bun.

## Cross-repo connections

- Home Assistant connects to `voice-bridge` over Wyoming (TCP 10700)
- `ci-server` grounds answers in CI-Server (Companion Memory) via `/memory/context`,
  `/memory/recall` and saves turns with `/memory/turn` (memory-scoped API key)
- Under Companion Hub, `ci-server` can use Hub's inference pool and audio routes



## Multi-agent safety

Multiple AI agents work these repos in parallel. Never use `git reset --hard`, `git clean -f`, or any destructive git command without explicit confirmation from the user.

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
