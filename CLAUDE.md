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

- Python / Home Assistant
- YAML configuration

## Key commands

```bash
# Install dependencies
pip install -r requirements.txt

# Start development server / service
# start Home Assistant

# Run tests
pytest

# Build for production
# no build
```

## Package manager

**pip** — use exclusively; do not mix with npm/yarn/pnpm/bun unless the repo explicitly requires it.

## Cross-repo connections

- Integrates Home Assistant voice pipeline with CI-Server LLM endpoint



## Multi-agent safety

Multiple AI agents work these repos in parallel. Never use `git reset --hard`, `git clean -f`, or any destructive git command without explicit confirmation from the user.

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
