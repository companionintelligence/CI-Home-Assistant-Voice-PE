import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';
import { authHeaders, resolveTtsProvider } from '../providers/audio';

const router = Router();

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};
const SUPPORTED_FORMATS = Object.keys(MIME_TYPES);
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
// Local engines name voices freely (af_heart, en_US-lessac-medium, ...).
const VOICE_PATTERN = /^[\w.:-]{1,100}$/;

/**
 * POST /v1/audio/speech
 * Convert text to speech and return audio bytes. Routes to a local
 * OpenAI-compatible TTS server (TTS_BASE_URL) or OpenAI.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  const input = body.input as string;
  const voice = (body.voice as string) || 'alloy';
  // OpenAI names this field response_format; `format` is kept for older clients.
  const format = (body.response_format as string) || (body.format as string) || 'mp3';
  const speed = (body.speed as number) || 1.0;

  if (!input || typeof input !== 'string') {
    res.status(400).json(
      makeOpenAIError("'input' is required", 'invalid_request_error', 'missing_required_parameter', 'input')
    );
    return;
  }

  if (!SUPPORTED_FORMATS.includes(format)) {
    res.status(400).json(
      makeOpenAIError(
        `Unsupported format '${format}'. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
        'invalid_request_error',
        'invalid_format',
        'format'
      )
    );
    return;
  }

  const provider = resolveTtsProvider();
  const voiceOk =
    provider.kind === 'openai' ? OPENAI_VOICES.includes(voice) : VOICE_PATTERN.test(voice);
  if (!voiceOk) {
    res.status(400).json(
      makeOpenAIError(`Unsupported voice '${voice}'.`, 'invalid_request_error', 'invalid_voice', 'voice')
    );
    return;
  }

  if (provider.kind === 'none') {
    logger.warn('Speech requested but no TTS provider is configured');
    res.status(503).json(
      makeOpenAIError(
        'No text-to-speech provider is configured. Set TTS_BASE_URL or OPENAI_API_KEY.',
        'server_error',
        'tts_not_configured'
      )
    );
    return;
  }

  const model =
    provider.kind === 'local' && config.ttsModel ? config.ttsModel : (body.model as string) || 'tts-1';
  logger.debug('Speech synthesis request', { provider: provider.kind, model, voice, format, inputLength: input.length });

  try {
    const upstream = await axios.post(
      `${provider.baseUrl}/v1/audio/speech`,
      { model, input, voice, speed, response_format: format },
      {
        headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );

    res.setHeader('Content-Type', MIME_TYPES[format]);
    res.send(Buffer.from(upstream.data as ArrayBuffer));
  } catch (err) {
    logger.error('Speech synthesis error', { provider: provider.kind, error: (err as Error).message });
    res.status(502).json(makeOpenAIError('TTS service error', 'server_error', 'speech_error'));
  }
});

export default router;
