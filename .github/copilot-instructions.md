# GitHub Copilot Instructions — CI-Home-Assistant-Voice-PE

You are working in **CI-Home-Assistant-Voice-PE**, the **Integration** component of the **Companion Intelligence** platform — a private, local-first digital memory and AI appliance system owned by Lifescope Inc.

## Platform architecture

```
Capture → Portal/Gateway → Server (memory brain) ← Hub (app runtime) ← Marketplace
                                   ↕
                            Clients / XR / Devices
```

Full architecture and ADRs live in `CI-Engineering/architecture/`.

## This repo

Home Assistant Voice PE integration for Companion Intelligence — voice pipeline extension.

## Tech stack

- `voice-bridge/`: Python 3.12 Wyoming server for Home Assistant
- `ci-server/`: Node 20 / TypeScript / Express OpenAI-compatible facade
- `web/`: https://ha.ci.computer setup site on Cloudflare Workers

## Development

```bash
scripts/test-all.sh   # every check
```



## Conventions

- Do not mix package managers.
- Keep PRs small and linked to CI-Engineering issues.
- Multiple agents may work this codebase simultaneously — never use destructive git operations.
- All code is **private and confidential** — do not surface or transmit source beyond this session.
