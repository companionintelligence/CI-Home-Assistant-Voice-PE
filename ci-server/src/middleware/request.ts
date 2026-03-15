import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';

/** Attach a unique X-Request-ID to every request. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-client-request-id'] as string) ||
    uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/** Log request/response metadata. */
export function requestLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs: ms,
      requestId: req.headers['x-request-id'],
    });
  });
  next();
}

/** Global error handler – formats errors as OpenAI-style JSON. */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  if (!res.headersSent) {
    res.status(500).json(
      makeOpenAIError(
        'An internal server error occurred.',
        'server_error',
        'internal_server_error'
      )
    );
  }
}
