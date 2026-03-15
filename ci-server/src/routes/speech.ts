import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';

const router = Router();

const SUPPORTED_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const SUPPORTED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

/**
 * POST /v1/audio/speech
 * Convert text to speech and return audio bytes.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  const model = (body.model as string) || 'tts-1';
  const input = body.input as string;
  const voice = (body.voice as string) || 'alloy';
  const format = (body.format as string) || 'mp3';
  const speed = (body.speed as number) || 1.0;

  if (!input) {
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

  if (!SUPPORTED_VOICES.includes(voice)) {
    res.status(400).json(
      makeOpenAIError(
        `Unsupported voice '${voice}'.`,
        'invalid_request_error',
        'invalid_voice',
        'voice'
      )
    );
    return;
  }

  logger.debug('Speech synthesis request', { model, voice, format, inputLength: input.length });

  try {
    if (config.openaiApiKey) {
      // Proxy to OpenAI TTS
      const upstream = await axios.post(
        `${config.openaiBaseUrl}/v1/audio/speech`,
        { model, input, voice, speed, response_format: format },
        {
          headers: {
            Authorization: `Bearer ${config.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        aac: 'audio/aac',
        flac: 'audio/flac',
        wav: 'audio/wav',
        pcm: 'audio/pcm',
      };

      res.setHeader('Content-Type', mimeTypes[format] || 'audio/mpeg');
      res.send(Buffer.from(upstream.data as ArrayBuffer));
    } else {
      // Stub: return a minimal valid response when no TTS is configured
      logger.warn('No TTS provider configured, returning empty audio stub');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(Buffer.alloc(0));
    }
  } catch (err) {
    logger.error('Speech synthesis error', { error: (err as Error).message });
    res.status(502).json(
      makeOpenAIError('TTS service error', 'server_error', 'speech_error')
    );
  }
});

export default router;
