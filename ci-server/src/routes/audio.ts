import { Router, Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioSizeBytes },
});

/**
 * POST /v1/audio/transcriptions
 * Accept multipart/form-data with an audio file and return a transcript.
 * Proxies to OpenAI Whisper or a local STT provider.
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

    const model = (req.body as Record<string, string>).model || 'whisper-1';
    const language = (req.body as Record<string, string>).language || undefined;

    logger.debug('Transcription request', {
      filename: req.file.originalname,
      size: req.file.size,
      model,
    });

    try {
      // Route to OpenAI Whisper if the model is whisper-* and we have an API key,
      // otherwise return a stub (useful for testing without credentials).
      if (model.startsWith('whisper') && config.openaiApiKey) {
        const form = new FormData();
        form.append('file', req.file.buffer, {
          filename: req.file.originalname || 'audio.wav',
          contentType: req.file.mimetype,
        });
        form.append('model', model);
        if (language) form.append('language', language);

        const upstream = await axios.post(
          `${config.openaiBaseUrl}/v1/audio/transcriptions`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${config.openaiApiKey}`,
            },
          }
        );

        res.json(upstream.data);
      } else {
        // Local stub – in production replace with Whisper.cpp / Vosk / Soniox
        logger.warn('No upstream STT configured, returning stub transcript');
        res.json({ text: '', language: language || 'en' });
      }
    } catch (err) {
      logger.error('Transcription error', { error: (err as Error).message });
      res.status(502).json(
        makeOpenAIError('Transcription service error', 'server_error', 'transcription_error')
      );
    }
  }
);

export default router;
