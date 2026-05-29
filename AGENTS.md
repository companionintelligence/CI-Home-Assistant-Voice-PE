# AGENTS.md — CI-Home-Assistant-Voice-PE

## Platform context

CI-Home-Assistant-Voice-PE is the **Integration** layer component of the Companion Intelligence platform — a private, local-first digital memory system.

Full architecture: `CI-Engineering/architecture/architecture.md`

## Repo summary

Home Assistant Voice PE integration for Companion Intelligence — voice pipeline extension.

## Stack

- Python / Home Assistant
- YAML configuration

## Setup & commands

```bash
pip install -r requirements.txt   # install
# start Home Assistant   # dev
pytest   # test
# no build   # build
```



## Git discipline

- Never `git reset --hard` or `git clean -f` without user confirmation.
- Commit messages: imperative mood, ≤ 72 chars.
- Reference CI-Engineering issues in PRs (e.g. `Closes companionintelligence/CI-Engineering#32`).

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
