# CI-Home-Assistant-Voice-PE

**Home Assistant Voice PE ↔ ci-server/Ollama via OpenAI-Compatible API**

This repository implements a complete voice assistant pipeline connecting the
[Home Assistant Voice Preview Edition (Voice PE)](https://www.home-assistant.io/voice_control/voice_remote_local_assistant/)
device to a self-hosted **OpenAI-compatible façade** (ci-server) backed by a local
[Ollama](https://ollama.ai/) LLM.

```
Voice PE (ESP32-S3 + XMOS)
    │  Wyoming WebSocket (audio PCM)
    ▼
Voice Bridge (Python)   ←→   ci-server (Node.js / TypeScript)
    │  VAD buffering               │  /v1/models
    │  PCM → WAV                   │  /v1/chat/completions  (SSE)
    │                              │  /v1/responses         (SSE)
    │  POST /v1/audio/transcriptions│  /v1/audio/transcriptions
    │  POST /v1/responses (stream)  │  /v1/audio/speech
    │  POST /v1/audio/speech        │
    ▼                              ▼
 Transcript / TTS audio        Ollama  (local LLM)
 sent back to HA               PostgreSQL + Redis (store)
```

## Repository Structure

```
.
├── ci-server/             # OpenAI-compatible façade (TypeScript / Express)
│   ├── src/
│   │   ├── app.ts         # Express app factory
│   │   ├── config.ts      # Environment config
│   │   ├── types.ts       # Canonical request/response types
│   │   ├── middleware/    # Auth, rate limiting, request ID, error handler
│   │   ├── normalizers/   # ChatAdapter & ResponsesAdapter
│   │   ├── providers/     # Ollama / vLLM / OpenAI routing
│   │   ├── routes/        # /v1/models, chat, responses, audio, speech
│   │   └── store/         # PostgreSQL + Redis conversation store
│   ├── tests/             # Jest integration tests
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── voice-bridge/          # Wyoming ↔ ci-server relay (Python / asyncio)
│   ├── src/
│   │   ├── audio/         # PCM ring buffer, VAD, WAV conversion
│   │   ├── client/        # HTTP client for ci-server (STT / LLM / TTS)
│   │   └── wyoming/       # Wyoming WebSocket protocol helpers
│   ├── tests/             # pytest unit tests
│   ├── main.py            # Entry point
│   ├── requirements.txt
│   └── Dockerfile
│
├── db/
│   └── migrations/
│       └── 001_initial.sql  # PostgreSQL schema
│
├── docker-compose.yml     # Full stack (Postgres, Redis, Ollama, ci-server, voice-bridge)
└── .env.example           # Environment variable template
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- (Optional) An [Ollama](https://ollama.ai/) model pulled: `ollama pull llama2`
- (Optional) An OpenAI API key for Whisper STT / cloud TTS fallback

### 1. Configure

```bash
cp .env.example .env
# Edit .env – at minimum set MASTER_API_KEY
```

### 2. Start the full stack

```bash
docker compose up -d
```

Services started:
| Service       | Port  | Description |
|---------------|-------|-------------|
| ci-server     | 8080  | OpenAI-compatible API façade |
| voice-bridge  | 10700 | Wyoming WebSocket server |
| postgres      | 5432  | Conversation store |
| redis         | 6379  | Stream cache & rate-limit buckets |
| ollama        | 11434 | Local LLM inference |

### 3. Verify ci-server

```bash
curl http://localhost:8080/health
# {"status":"ok","version":"1.0.0"}

curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer change-me-in-production"
```

### 4. Connect Home Assistant

In your Home Assistant configuration, add a
[Wyoming integration](https://www.home-assistant.io/integrations/wyoming/)
pointing to `ws://<voice-bridge-host>:10700`.

The Voice Bridge will:
1. Receive PCM audio from the Voice PE via Wyoming
2. Apply energy-based VAD to detect utterance boundaries
3. Convert PCM → WAV and send to `/v1/audio/transcriptions`
4. Stream the transcript to `/v1/responses` (LLM via Ollama)
5. Synthesize the reply via `/v1/audio/speech`
6. Send the audio back to HA / Voice PE for playback

## API Reference

All endpoints follow the OpenAI API specification.

### Authentication

```
Authorization: Bearer <MASTER_API_KEY>
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check (unauthenticated) |
| `GET`  | `/v1/models` | List available models |
| `POST` | `/v1/chat/completions` | Chat completions (streaming SSE supported) |
| `POST` | `/v1/responses` | Responses API (typed SSE events) |
| `POST` | `/v1/audio/transcriptions` | Speech-to-text (multipart WAV/MP3) |
| `POST` | `/v1/audio/speech` | Text-to-speech (returns MP3/WAV bytes) |

### Streaming

**Chat completions** (`stream: true`):
```
data: {"id":"chatcmpl_001","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}
data: {"id":"chatcmpl_001","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

**Responses** (`stream: true`):
```
data: {"type":"response.created","response":{"id":"resp_abc","status":"in_progress"}}
data: {"type":"response.output_text.delta","delta":"Sure, turning on the lights."}
data: {"type":"response.completed","response":{"id":"resp_abc","status":"completed","finish_reason":"stop"}}
```

### Example: Chat Completion

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer change-me-in-production" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama:llama2",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "Turn on the living room light."}
    ],
    "stream": false
  }'
```

### Example: Transcription

```bash
curl http://localhost:8080/v1/audio/transcriptions \
  -H "Authorization: Bearer change-me-in-production" \
  -F file=@command.wav \
  -F model=whisper-1
```

## Development

### ci-server (TypeScript)

```bash
cd ci-server
npm install
npm test        # Jest tests
npm run build   # TypeScript compile
npm run dev     # ts-node development server
```

### voice-bridge (Python)

```bash
cd voice-bridge
pip install -r requirements.txt
pytest tests/   # unit tests
python main.py  # development server
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | ci-server HTTP port |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OPENAI_API_KEY` | _(empty)_ | OpenAI API key (optional fallback) |
| `MASTER_API_KEY` | `dev-key-change-me` | Bearer token for API auth |
| `CORS_ORIGINS` | `*` | Comma-separated CORS origins |
| `CI_SERVER_URL` | `http://localhost:8080` | ci-server URL (voice-bridge) |
| `CI_SERVER_API_KEY` | `dev-key-change-me` | API key (voice-bridge) |
| `CI_MODEL` | `ollama:llama2` | LLM model to use |
| `VOICE_BRIDGE_PORT` | `10700` | Wyoming WebSocket port |
| `SAMPLE_RATE` | `16000` | Audio sample rate (Hz) |

## Architecture

See the [Technical Plan](https://github.com/companionintelligence/CI-Home-Assistant-Voice-PE/issues)
for the full design document including:

- Voice PE hardware capabilities (ESP32-S3 + XMOS XU316)
- Wyoming protocol transport details
- STT/TTS provider comparison table
- Latency budget (target: <2 s end-to-end)
- Provider routing (Ollama stateless handling via conversation store)
- Multi-tenancy and API key management
- Database schema (PostgreSQL + Redis)