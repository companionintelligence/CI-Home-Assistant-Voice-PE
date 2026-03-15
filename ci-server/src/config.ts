import dotenv from 'dotenv';
dotenv.config();

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

  // Auth
  masterApiKey: process.env.MASTER_API_KEY || 'dev-key-change-me',
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
