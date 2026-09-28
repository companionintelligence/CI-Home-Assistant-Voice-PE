import { Router, Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';
import { authHeaders, resolveSttProvider } from '../providers/audio';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioSizeBytes },
});

/** Optional OpenAI transcription fields forwarded verbatim when present. */
const PASSTHROUGH_FIELDS = ['language', 'prompt', 'response_format', 'temperature'];

/**
 * POST /v1/audio/transcriptions
 * Accept multipart/form-data with an audio file and return a transcript.
 * Proxies to a local OpenAI-compatible STT server (STT_BASE_URL) or OpenAI Whisper.
 */
router.post(
  '/transcriptions',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json(
        makeOpenAIError('No audio file provided', 'invalid_request_error', 'missing_file', 'file')
      );
      return;
    }

    const fields = req.body as Record<string, string>;
    const requestedModel = fields.model || 'whisper-1';
    const provider = resolveSttProvider(requestedModel);

    if (provider.kind === 'none') {
      logger.warn('Transcription requested but no STT provider is configured');
      res.status(503).json(
        makeOpenAIError(
          'No speech-to-text provider is configured. Set STT_BASE_URL or OPENAI_API_KEY.',
          'server_error',
          'stt_not_configured'
        )
      );
      return;
    }

    const model = provider.kind === 'local' && config.sttModel ? config.sttModel : requestedModel;
    logger.debug('Transcription request', {
      provider: provider.kind,
      size: req.file.size,
      model,
    });

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.wav',
      contentType: req.file.mimetype || 'audio/wav',
    });
    form.append('model', model);
    for (const field of PASSTHROUGH_FIELDS) {
      if (fields[field]) form.append(field, fields[field]);
    }

    try {
      const upstream = await axios.post(`${provider.baseUrl}/v1/audio/transcriptions`, form, {
        headers: { ...form.getHeaders(), ...authHeaders(provider) },
        timeout: 120000,
        maxBodyLength: config.maxAudioSizeBytes * 2,
      });
      res.json(upstream.data);
    } catch (err) {
      logger.error('Transcription error', { provider: provider.kind, error: (err as Error).message });
      res.status(502).json(
        makeOpenAIError('Transcription service error', 'server_error', 'transcription_error')
      );
    }
  }
);

export default router;
