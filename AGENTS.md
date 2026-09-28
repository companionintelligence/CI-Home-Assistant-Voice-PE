# AGENTS.md — CI-Home-Assistant-Voice-PE

## Platform context

CI-Home-Assistant-Voice-PE is the **Integration** layer component of the Companion Intelligence platform — a private, local-first digital memory system.

Full architecture: `CI-Engineering/architecture/architecture.md`

## Repo summary

Home Assistant Voice PE integration for Companion Intelligence — voice pipeline extension.

## Stack

- `voice-bridge/`: Python 3.12 Wyoming server (`wyoming` library)
- `ci-server/`: Node 20 / TypeScript / Express OpenAI-compatible facade
- `web/`: https://ha.ci.computer setup site (Cloudflare Worker, static assets)

## Setup & commands

```bash
scripts/test-all.sh                                   # every check
cd voice-bridge && python -m pytest                   # bridge tests
cd ci-server && npm test && npm run typecheck         # facade tests
python -m pytest e2e                                  # whole stack (after npm run build)
cd web && npm test && npm run check                   # site tests + wrangler dry run
docker compose up -d                                  # run the stack
```



## Git discipline

- Never `git reset --hard` or `git clean -f` without user confirmation.
- Commit messages: imperative mood, ≤ 72 chars.
- Reference CI-Engineering issues in PRs (e.g. `Closes companionintelligence/CI-Engineering#32`).

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
