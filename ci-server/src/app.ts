import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { requestIdMiddleware, requestLogMiddleware, errorHandler } from './middleware/request';
import modelsRouter from './routes/models';
import chatRouter from './routes/chat';
import responsesRouter from './routes/responses';
import audioRouter from './routes/audio';
import speechRouter from './routes/speech';

export function createApp(): express.Application {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────────────
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Client-Request-Id'],
    })
  );

  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware);

  // Rate limiter (applied before body parsing)
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        message: 'Too many requests, please slow down.',
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
    },
  });
  app.use('/v1', limiter);

  // Body parsers – only for non-multipart routes (multer handles multipart)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Health check (unauthenticated) ────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  // ── OpenAI-compatible v1 routes (authenticated) ───────────────────────────
  app.use('/v1/models', authMiddleware, modelsRouter);
  app.use('/v1/chat/completions', authMiddleware, chatRouter);
  app.use('/v1/responses', authMiddleware, responsesRouter);
  app.use('/v1/audio', authMiddleware, audioRouter);
  app.use('/v1/audio/speech', authMiddleware, speechRouter);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
