import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';

/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer <api-key>
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json(
      makeOpenAIError('No API key provided', 'authentication_error', 'invalid_api_key')
    );
    return;
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();

  // In production this should validate against the tenants table in the DB.
  // For now accept any key that matches the master key or a non-empty string
  // (permissive dev mode) while still rejecting blank keys.
  if (!apiKey) {
    res.status(401).json(
      makeOpenAIError('Invalid API key', 'authentication_error', 'invalid_api_key')
    );
    return;
  }

  if (config.nodeEnv === 'production' && apiKey !== config.masterApiKey) {
    logger.warn('Rejected request with invalid API key', { path: req.path });
    res.status(401).json(
      makeOpenAIError('Incorrect API key', 'authentication_error', 'invalid_api_key')
    );
    return;
  }

  // Attach tenant context (simplified – real impl looks up DB)
  (req as Request & { tenantId?: string }).tenantId = 'default';
  next();
}
