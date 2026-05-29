# ANTIGRAVITY.md — CI-Home-Assistant-Voice-PE

## Context

**CI-Home-Assistant-Voice-PE** — **Integration** layer of the Companion Intelligence platform (Lifescope Inc).

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`

## Purpose

Home Assistant Voice PE integration for Companion Intelligence — voice pipeline extension.

## Stack

- Python / Home Assistant
- YAML configuration

## Commands

```bash
pip install -r requirements.txt
# start Home Assistant
pytest
```

## Rules

- Package manager: do not switch or mix.
- Destructive git operations (`reset --hard`, `clean -f`) require explicit user confirmation.
- Commits reference CI-Engineering issues.
- All content is **private and confidential** — Property of Lifescope Inc.
