import { config } from '../config';

export type AudioProviderKind = 'local' | 'openai' | 'none';

export interface AudioProvider {
  kind: AudioProviderKind;
  /** Base URL without /v1; routes append /v1/audio/... */
  baseUrl: string;
  apiKey: string;
}

/**
 * Speech-to-text routing: a configured OpenAI-compatible STT server wins,
 * then OpenAI Whisper (for whisper-* models with an API key), else none.
 */
export function resolveSttProvider(model: string): AudioProvider {
  if (config.sttBaseUrl) {
    return { kind: 'local', baseUrl: config.sttBaseUrl, apiKey: config.sttApiKey };
  }
  if (config.openaiApiKey && model.startsWith('whisper')) {
    return { kind: 'openai', baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey };
  }
  return { kind: 'none', baseUrl: '', apiKey: '' };
}

/** Text-to-speech routing: a configured OpenAI-compatible TTS server wins, then OpenAI. */
export function resolveTtsProvider(): AudioProvider {
  if (config.ttsBaseUrl) {
    return { kind: 'local', baseUrl: config.ttsBaseUrl, apiKey: config.ttsApiKey };
  }
  if (config.openaiApiKey) {
    return { kind: 'openai', baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey };
  }
  return { kind: 'none', baseUrl: '', apiKey: '' };
}

export function authHeaders(provider: AudioProvider): Record<string, string> {
  return provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
}
