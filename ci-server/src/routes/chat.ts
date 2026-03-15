import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { normalizeChatRequest } from '../normalizers';
import { chatCompletion, streamChatCompletion } from '../providers';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';
import { config } from '../config';

const router = Router();

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completions endpoint with optional SSE streaming.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  if (!body.model) {
    res.status(400).json(makeOpenAIError("'model' is required", 'invalid_request_error', 'missing_required_parameter', 'model'));
    return;
  }

  const canonical = normalizeChatRequest(body);
  canonical.requestId = (req.headers['x-request-id'] as string) || uuidv4();

  if (canonical.stream) {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, config.sseHeartbeatIntervalMs);

    try {
      await streamChatCompletion(
        canonical,
        (chunk: string) => {
          if (!res.writableEnded) {
            res.write(`data: ${chunk}\n\n`);
          }
        },
        () => {
          clearInterval(heartbeat);
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }
      );
    } catch (err) {
      clearInterval(heartbeat);
      logger.error('Streaming error in chat/completions', { error: (err as Error).message });
      if (!res.writableEnded) {
        const errData = makeOpenAIError(
          'Upstream provider error',
          'server_error',
          'upstream_error'
        );
        res.write(`data: ${JSON.stringify(errData)}\n\n`);
        res.end();
      }
    }
  } else {
    try {
      const result = await chatCompletion(canonical);

      // Format as OpenAI chat completion response
      res.json({
        id: result.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: canonical.model,
        choices: [
          {
            index: 0,
            message: {
              role: result.message?.role || 'assistant',
              content: result.message?.content || '',
            },
            finish_reason: result.finishReason || 'stop',
          },
        ],
        usage: result.usage
          ? {
              prompt_tokens: result.usage.promptTokens,
              completion_tokens: result.usage.completionTokens,
              total_tokens: result.usage.totalTokens,
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Error in chat/completions', { error: (err as Error).message });
      res.status(502).json(
        makeOpenAIError('Upstream provider error', 'server_error', 'upstream_error')
      );
    }
  }
});

export default router;
