import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';

/**
 * Constant-time secret comparison.
 * Both sides are SHA-256 digested first so the comparison always runs over
 * two fixed-width buffers – `timingSafeEqual` throws on a length mismatch,
 * and short-circuiting on length would leak the master key's length.
 */
function secretsMatch(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer <api-key>
 *
 * Enforced in *every* environment. This used to be a no-op unless
 * NODE_ENV === 'production', which left every staging, development and
 * self-hosted deployment that did not set NODE_ENV completely open.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Fail closed: an unconfigured master key must never mean "allow everyone".
  if (!config.masterApiKey) {
    logger.error(
      'MASTER_API_KEY is not set – refusing every authenticated request. Set MASTER_API_KEY to enable the API.',
      { path: req.path }
    );
    res.status(503).json(
      makeOpenAIError(
        'Server authentication is not configured.',
        'server_error',
        'auth_not_configured'
      )
    );
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json(
      makeOpenAIError('No API key provided', 'authentication_error', 'invalid_api_key')
    );
    return;
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();

  // Validated against the master key. A real multi-tenant implementation
  // should validate against the tenants table in the DB instead.
  if (!apiKey) {
    res.status(401).json(
      makeOpenAIError('Invalid API key', 'authentication_error', 'invalid_api_key')
    );
    return;
  }

  if (!secretsMatch(apiKey, config.masterApiKey)) {
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
