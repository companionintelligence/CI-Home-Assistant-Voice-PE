import dotenv from 'dotenv';
dotenv.config();

/** Base URL without a trailing slash or a trailing /v1 (routes add /v1 themselves). */
function baseUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/ci_voice',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Ollama
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',

  // OpenAI upstream (optional fallback)
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',

  // vLLM (optional)
  vllmBaseUrl: process.env.VLLM_BASE_URL || '',

  // Model used when a client does not name one
  defaultModel: process.env.CI_MODEL || 'ollama:llama3.2',

  // Speech-to-text: any OpenAI-compatible server (speaches, Companion Hub
  // inference, faster-whisper-server, ...). Takes priority over OpenAI.
  sttBaseUrl: baseUrl(process.env.STT_BASE_URL),
  sttApiKey: process.env.STT_API_KEY || '',
  // Replaces the client's model name (e.g. "whisper-1") when set.
  sttModel: process.env.STT_MODEL || '',

  // Text-to-speech: any OpenAI-compatible server (speaches/Kokoro,
  // Kokoro-FastAPI, Companion Hub inference, ...). Takes priority over OpenAI.
  ttsBaseUrl: baseUrl(process.env.TTS_BASE_URL),
  ttsApiKey: process.env.TTS_API_KEY || '',
  ttsModel: process.env.TTS_MODEL || '',

  // Companion Memory (CI-Server). With a memory-scoped API key, each turn is
  // grounded in the user's memory and saved back to it.
  memoryUrl: baseUrl(process.env.CI_MEMORY_URL),
  memoryApiKey: process.env.CI_MEMORY_API_KEY || '',
  memoryRecall: flag(process.env.CI_MEMORY_RECALL, true),
  memorySaveTurns: flag(process.env.CI_MEMORY_SAVE_TURNS, true),
  memoryMaxResults: parseInt(process.env.CI_MEMORY_MAX_RESULTS || '5', 10),
  // Recall sits on the voice latency path, so it gets a tight budget.
  memoryTimeoutMs: parseInt(process.env.CI_MEMORY_TIMEOUT_MS || '1500', 10),
  memoryPlatform: process.env.CI_MEMORY_PLATFORM || 'ha-voice-pe',

  // Auth
  // No fallback on purpose: when MASTER_API_KEY is unset, authMiddleware
  // rejects every request rather than accepting a well-known default key.
  masterApiKey: process.env.MASTER_API_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),

  // Audio
  maxAudioSizeBytes: parseInt(process.env.MAX_AUDIO_SIZE_BYTES || '26214400', 10), // 25 MB
  audioStorageUrl: process.env.AUDIO_STORAGE_URL || 'http://localhost:8080/audio',

  // Streaming
  sseHeartbeatIntervalMs: parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000', 10),
};
