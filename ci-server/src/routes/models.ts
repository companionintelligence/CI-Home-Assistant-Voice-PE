import { Router, Request, Response } from 'express';
import { listModels } from '../providers';
import { config } from '../config';

const router = Router();

/**
 * GET /v1/models
 * Returns the list of available models in OpenAI format.
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const upstream = await listModels();

  // Ensure we always return at least a placeholder if Ollama is unreachable
  const data =
    upstream.length > 0
      ? upstream
      : [
          {
            id: config.defaultModel,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'ollama',
          },
        ];

  res.json({ object: 'list', data });
});

export default router;
