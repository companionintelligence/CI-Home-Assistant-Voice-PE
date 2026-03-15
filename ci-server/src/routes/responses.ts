import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { normalizeResponsesRequest } from '../normalizers';
import { chatCompletion, streamChatCompletion } from '../providers';
import { logger } from '../logger';
import { makeOpenAIError } from '../types';
import { config } from '../config';

const router = Router();

/**
 * POST /v1/responses
 * OpenAI Responses API endpoint with optional SSE streaming.
 * Emits typed SSE events: response.created, response.output_text.delta, response.completed
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  if (!body.model) {
    res.status(400).json(
      makeOpenAIError("'model' is required", 'invalid_request_error', 'missing_required_parameter', 'model')
    );
    return;
  }

  const canonical = normalizeResponsesRequest(body);
  canonical.requestId = (req.headers['x-request-id'] as string) || uuidv4();
  const responseId = `resp_${canonical.requestId.replace(/-/g, '').slice(0, 20)}`;

  if (canonical.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, config.sseHeartbeatIntervalMs);

    const sendEvent = (event: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    // Emit response.created
    sendEvent({
      type: 'response.created',
      response: { id: responseId, status: 'in_progress' },
    });

    try {
      let fullContent = '';

      await streamChatCompletion(
        canonical,
        (chunk: string) => {
          try {
            const parsed = JSON.parse(chunk) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string;
              }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              sendEvent({ type: 'response.output_text.delta', delta });
            }
          } catch {
            // ignore parse errors for malformed chunks
          }
        },
        () => {
          clearInterval(heartbeat);
          sendEvent({
            type: 'response.completed',
            response: {
              id: responseId,
              status: 'completed',
              finish_reason: 'stop',
              output_text: fullContent,
            },
          });
          if (!res.writableEnded) {
            res.end();
          }
        }
      );
    } catch (err) {
      clearInterval(heartbeat);
      logger.error('Streaming error in /responses', { error: (err as Error).message });
      sendEvent({
        type: 'response.failed',
        response: { id: responseId, status: 'failed' },
        error: { message: 'Upstream provider error', code: 'upstream_error' },
      });
      if (!res.writableEnded) res.end();
    }
  } else {
    try {
      const result = await chatCompletion(canonical);
      const outputText = result.message?.content || '';

      res.json({
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        finish_reason: result.finishReason || 'stop',
        model: canonical.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: outputText }],
          },
        ],
        usage: result.usage
          ? {
              input_tokens: result.usage.promptTokens,
              output_tokens: result.usage.completionTokens,
              total_tokens: result.usage.totalTokens,
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Error in /responses', { error: (err as Error).message });
      res.status(502).json(
        makeOpenAIError('Upstream provider error', 'server_error', 'upstream_error')
      );
    }
  }
});

export default router;
