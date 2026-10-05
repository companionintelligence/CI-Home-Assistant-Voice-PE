#!/usr/bin/env bash
# Run every check this repo has, the same way .github/workflows/ci.yml does.
# Usage: scripts/test-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "ci-server: install, typecheck, unit tests, build"
(cd ci-server && npm ci --no-audit --no-fund && npm run typecheck && npm test -- --silent && npm run build)

step "voice-bridge: unit and Wyoming end-to-end tests"
python -m pip install -q -r voice-bridge/requirements.txt -r voice-bridge/requirements-dev.txt
(cd voice-bridge && python -m pytest -q)

step "whole stack: real ci-server + real bridge, stubbed upstreams"
# The build above just made ci-server/dist. Without this, a missing build would
# skip the suite and still exit 0.
export REQUIRE_E2E=1
python -m pytest e2e -q

step "web: setup page logic, compose drift, wrangler dry run"
(cd web && npm ci --no-audit --no-fund && npm test && npx wrangler deploy --dry-run --outdir .wrangler/dry-run)

if command -v docker >/dev/null 2>&1; then
  step "compose files parse"
  printf 'MASTER_API_KEY=x\nPOSTGRES_PASSWORD=x\nJWT_SECRET=x\n' > /tmp/ci-ha-voice.env
  docker compose --env-file /tmp/ci-ha-voice.env config --quiet
  docker compose --env-file /tmp/ci-ha-voice.env -f web/public/compose.yml config --quiet
fi

step "all checks passed"
