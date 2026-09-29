#!/usr/bin/env bash
# Opt-in evidence, not part of scripts/test-all.sh: the core Home Assistant
# Wyoming integration, running in a real Home Assistant 2026.9.4 container,
# sees the real voice bridge and answers one conversation.
#
# Host processes on ephemeral ports: stubs for Ollama, speech and Companion
# Memory, the built facade (ci-server/dist, never rebuilt here) and the real
# bridge (voice-bridge/main.py). One container runs Home Assistant with a
# minimal configuration.yaml (no default_config) and reaches the bridge as
# host.docker.internal. scripts/voice_container_smoke_driver.py completes
# onboarding, adds the wyoming integration through its config flow, finds the
# companion-stt, companion-tts and companion-conversation entities and runs one
# conversation/process against the stubbed model.
#
# Usage: scripts/voice-container-smoke.sh
#   PYTHON      interpreter with aiohttp and wyoming (default: python3)
#   REQUIRE_HA  when set, or when CI is set, a missing Docker daemon, image or
#               build is a failure. Otherwise the script prints SKIPPED and exits 0.
#
# It only ever touches what it creates: one container named impl1-ha-smoke-<pid>,
# one temp directory and its own child processes.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

HA_VERSION=2026.9.4
HA_IMAGE_REMOTE="ghcr.io/home-assistant/home-assistant:${HA_VERSION}"
HA_IMAGE_LOCAL="homeassistant/home-assistant:stable"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$ROOT/scripts/voice_container_smoke_driver.py"
CONTAINER="impl1-ha-smoke-$$"
MASTER_KEY="smoke-master-key"
MEMORY_KEY="smoke-memory-key"

WORK=""
CONTAINER_CREATED=""
PIDS=()
LOGS=()

log() { printf '[smoke] %s\n' "$*"; }

flag() {
  local value
  value="$(printf '%s' "${!1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in "" | 0 | false | no | off) return 1 ;; *) return 0 ;; esac
}

# A missing prerequisite is a skip on a laptop and a failure where the run is required.
unavailable() {
  if flag REQUIRE_HA || flag CI; then
    printf 'FAILED: %s (REQUIRE_HA or CI is set)\n' "$1" >&2
    exit 1
  fi
  printf 'SKIPPED: %s\n' "$1"
  exit 0
}

tail_logs() {
  local file
  if [ -n "$CONTAINER_CREATED" ]; then
    printf '\n--- last lines of the Home Assistant container log ---\n' >&2
    docker logs --tail 60 "$CONTAINER" >&2 2>&1 || true
  fi
  for file in ${LOGS[@]+"${LOGS[@]}"}; do
    [ -s "$file" ] || continue
    printf '\n--- last lines of %s ---\n' "$(basename "$file")" >&2
    tail -n 30 "$file" >&2 || true
  done
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [ "$status" -ne 0 ]; then tail_logs; fi
  if [ -n "$CONTAINER_CREATED" ]; then
    docker rm -f -v "$CONTAINER" >/dev/null 2>&1
  fi
  local pid tries
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null
    tries=0
    while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 50 ]; do
      sleep 0.1
      tries=$((tries + 1))
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  done
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# Bash runs a signal trap only when the foreground command ends, so anything long
# runs in the background and is waited on: a cancel then cleans up at once.
interruptible() {
  local pid rc=0
  "$@" &
  pid=$!
  PIDS+=("$pid")
  wait "$pid" || rc=$?
  return "$rc"
}

# ---- preflight: skip or fail before anything is started ----------------------

command -v docker >/dev/null 2>&1 || unavailable "docker is not installed"
DOCKER_PS_TIMEOUT=()
if command -v timeout >/dev/null 2>&1; then DOCKER_PS_TIMEOUT=(timeout 30); fi
if ! ${DOCKER_PS_TIMEOUT[@]+"${DOCKER_PS_TIMEOUT[@]}"} docker ps >/dev/null 2>&1; then
  unavailable "docker ps failed, no Docker daemon is reachable"
fi

command -v node >/dev/null 2>&1 || unavailable "node is not installed"
PY="$(command -v "${PYTHON:-python3}" 2>/dev/null || true)"
[ -n "$PY" ] || unavailable "python interpreter not found (set PYTHON)"
"$PY" -c 'import aiohttp, wyoming' >/dev/null 2>&1 \
  || unavailable "$PY cannot import aiohttp and wyoming (pip install -r voice-bridge/requirements.txt)"
[ -f "$ROOT/ci-server/dist/index.js" ] \
  || unavailable "ci-server/dist is missing, build it first with npm --prefix ci-server run build (this script never builds)"

# The image: the pinned ghcr tag when it is here or can be pulled, otherwise the
# local stable tag, but only when it reports the pinned version.
image_version() { docker image inspect --format '{{index .Config.Labels "io.hass.version"}}' "$1" 2>/dev/null || true; }

IMAGE=""
if docker image inspect "$HA_IMAGE_REMOTE" >/dev/null 2>&1; then
  IMAGE="$HA_IMAGE_REMOTE"
else
  log "pulling $HA_IMAGE_REMOTE"
  PULL_TIMEOUT=()
  if command -v timeout >/dev/null 2>&1; then PULL_TIMEOUT=(timeout 900); fi
  if interruptible ${PULL_TIMEOUT[@]+"${PULL_TIMEOUT[@]}"} docker pull -q "$HA_IMAGE_REMOTE" >/dev/null 2>&1; then
    IMAGE="$HA_IMAGE_REMOTE"
  elif [ "$(image_version "$HA_IMAGE_LOCAL")" = "$HA_VERSION" ]; then
    log "could not pull $HA_IMAGE_REMOTE, using the local $HA_IMAGE_LOCAL"
    IMAGE="$HA_IMAGE_LOCAL"
  fi
fi
[ -n "$IMAGE" ] || unavailable "no Home Assistant $HA_VERSION image: $HA_IMAGE_REMOTE cannot be pulled and $HA_IMAGE_LOCAL reports '$(image_version "$HA_IMAGE_LOCAL")'"
[ "$(image_version "$IMAGE")" = "$HA_VERSION" ] \
  || unavailable "$IMAGE reports version '$(image_version "$IMAGE")', not $HA_VERSION"
log "image $IMAGE (io.hass.version $(image_version "$IMAGE"))"

# ---- host side: stubs, facade, bridge ----------------------------------------

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ci-ha-voice-smoke.XXXXXX")"
mkdir -p "$WORK/config"
CALLS="$WORK/stub-calls.jsonl"

PORTS=($("$PY" "$DRIVER" free-ports 3))
STUBS_PORT="${PORTS[0]}"
FACADE_PORT="${PORTS[1]}"
BRIDGE_PORT="${PORTS[2]}"
STUBS_URL="http://127.0.0.1:$STUBS_PORT"
log "ports: stubs $STUBS_PORT, facade $FACADE_PORT, bridge $BRIDGE_PORT"

wait_for_port() { # port pid name
  local tries=0
  while [ "$tries" -lt 150 ]; do
    if ! kill -0 "$2" 2>/dev/null; then
      printf 'FAILED: %s exited before opening port %s\n' "$3" "$1" >&2
      return 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then return 0; fi
    sleep 0.2
    tries=$((tries + 1))
  done
  printf 'FAILED: %s never opened port %s\n' "$3" "$1" >&2
  return 1
}

start() { # name, then the command; logs to $WORK/<name>.log and records the pid
  local name=$1
  shift
  LOGS+=("$WORK/$name.log")
  "$@" >"$WORK/$name.log" 2>&1 &
  PIDS+=("$!")
  LAST_PID=$!
}

start stubs env PYTHONDONTWRITEBYTECODE=1 "$PY" "$DRIVER" stubs --port "$STUBS_PORT" --calls-file "$CALLS"
wait_for_port "$STUBS_PORT" "$LAST_PID" "the stubs"

# Same environment as e2e/test_stack.py. DATABASE_URL and REDIS_URL point nowhere
# on purpose: the facade must not need them to serve voice.
start facade env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
  NODE_ENV=production PORT="$FACADE_PORT" MASTER_API_KEY="$MASTER_KEY" \
  OLLAMA_BASE_URL="$STUBS_URL" CI_MODEL="ollama:llama3.2" \
  STT_BASE_URL="$STUBS_URL" STT_MODEL="Systran/faster-distil-whisper-small.en" \
  TTS_BASE_URL="$STUBS_URL" TTS_MODEL="speaches-ai/Kokoro-82M-v1.0-ONNX" \
  CI_MEMORY_URL="$STUBS_URL" CI_MEMORY_API_KEY="$MEMORY_KEY" \
  DATABASE_URL="postgresql://nobody@127.0.0.1:1/none" REDIS_URL="redis://127.0.0.1:1" \
  node "$ROOT/ci-server/dist/index.js"
wait_for_port "$FACADE_PORT" "$LAST_PID" "the facade"

# The bridge listens on every interface so the container can reach it through
# host.docker.internal, exactly as it does in docker-compose.yml.
start bridge env -i PATH="$PATH" HOME="${HOME:-/tmp}" PYTHONDONTWRITEBYTECODE=1 \
  CI_SERVER_URL="http://127.0.0.1:$FACADE_PORT" CI_SERVER_API_KEY="$MASTER_KEY" \
  CI_MODEL="ollama:llama3.2" CI_TTS_VOICE="af_heart" \
  VOICE_BRIDGE_HOST="0.0.0.0" VOICE_BRIDGE_PORT="$BRIDGE_PORT" \
  "$PY" "$ROOT/voice-bridge/main.py"
wait_for_port "$BRIDGE_PORT" "$LAST_PID" "the bridge"
log "host stack up after ${SECONDS}s"

# ---- Home Assistant container -------------------------------------------------

# Not default_config: it starts integrations that reach the internet, and the
# container has no CA for the sandbox proxy. This is what onboarding, auth,
# conversation, stt, tts and wyoming (with its assist_pipeline dependency) need.
cat >"$WORK/config/configuration.yaml" <<'YAML'
homeassistant:
  name: Voice Smoke
  unit_system: metric
  time_zone: UTC
  latitude: 0
  longitude: 0
http:
auth:
onboarding:
config:
conversation:
stt:
tts:
logger:
  default: warning
  logs:
    homeassistant.components.wyoming: debug
YAML

# docker cp instead of a bind mount: Home Assistant runs as root and would leave
# root-owned files in the temp directory that a normal user cannot remove.
docker create --name "$CONTAINER" --add-host host.docker.internal:host-gateway \
  -p 127.0.0.1::8123 "$IMAGE" >/dev/null
CONTAINER_CREATED=1
docker cp "$WORK/config/." "$CONTAINER:/config"
docker start "$CONTAINER" >/dev/null
HA_PORT="$(docker port "$CONTAINER" 8123/tcp | head -n 1 | sed 's/.*://')"
log "container $CONTAINER started, Home Assistant on 127.0.0.1:$HA_PORT (after ${SECONDS}s)"

STATUS=0
interruptible "$PY" "$DRIVER" drive \
  --base-url "http://127.0.0.1:$HA_PORT" \
  --container "$CONTAINER" \
  --bridge-host host.docker.internal --bridge-port "$BRIDGE_PORT" \
  --calls-file "$CALLS" --expect-version "$HA_VERSION" || STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  log "core Home Assistant library: wyoming $(docker exec "$CONTAINER" python3 -c 'import importlib.metadata as m; print(m.version("wyoming"))' 2>/dev/null || echo unknown)"
  log "bridge library: wyoming $("$PY" -c 'import importlib.metadata as m; print(m.version("wyoming"))')"
  log "total ${SECONDS}s"
  printf 'PASSED: core Home Assistant %s sees the real voice bridge and answers a conversation\n' "$HA_VERSION"
fi
exit "$STATUS"
