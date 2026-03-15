import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { CanonicalRequest, CanonicalResponse } from '../types';

/**
 * Maps a CanonicalRequest to an Ollama/OpenAI-compatible request body.
 */
function toProviderBody(req: CanonicalRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolveModelName(req.model),
    messages: req.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.toolCalls) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return msg;
    }),
    stream: req.stream,
  };

  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  if (req.params.temperature !== undefined) body.temperature = req.params.temperature;
  if (req.params.topP !== undefined) body.top_p = req.params.topP;
  if (req.params.maxTokens !== undefined) body.max_tokens = req.params.maxTokens;
  if (req.params.frequencyPenalty !== undefined)
    body.frequency_penalty = req.params.frequencyPenalty;
  if (req.params.presencePenalty !== undefined) body.presence_penalty = req.params.presencePenalty;
  if (req.params.stop !== undefined) body.stop = req.params.stop;
  if (req.params.seed !== undefined) body.seed = req.params.seed;

  return body;
}

/** Strip provider prefixes like "ollama:" or "openai:" from model names. */
function resolveModelName(model: string): string {
  const prefixes = ['ollama:', 'openai:', 'vllm:', 'tts:', 'whisper:'];
  for (const p of prefixes) {
    if (model.startsWith(p)) return model.slice(p.length);
  }
  return model;
}

/** Determine which provider to use based on the model string prefix. */
export type ProviderName = 'ollama' | 'openai' | 'vllm';

export function resolveProvider(model: string): ProviderName {
  if (model.startsWith('openai:')) return 'openai';
  if (model.startsWith('vllm:') && config.vllmBaseUrl) return 'vllm';
  return 'ollama'; // default to Ollama
}

function getProviderBaseUrl(provider: ProviderName): string {
  switch (provider) {
    case 'openai':
      return config.openaiBaseUrl;
    case 'vllm':
      return config.vllmBaseUrl;
    default:
      return config.ollamaBaseUrl;
  }
}

function createAxiosInstance(provider: ProviderName): AxiosInstance {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'openai' && config.openaiApiKey) {
    headers['Authorization'] = `Bearer ${config.openaiApiKey}`;
  }
  return axios.create({ baseURL: getProviderBaseUrl(provider), headers });
}

/**
 * List models from the target provider.
 */
export async function listModels(): Promise<unknown[]> {
  try {
    const client = createAxiosInstance('ollama');
    const res = await client.get('/v1/models');
    return (res.data as { data?: unknown[] }).data || [];
  } catch (err) {
    logger.warn('Could not fetch models from Ollama', { error: (err as Error).message });
    return [];
  }
}

/**
 * Send a non-streaming chat completion and return a canonical response.
 */
export async function chatCompletion(req: CanonicalRequest): Promise<CanonicalResponse> {
  const provider = resolveProvider(req.model);
  const client = createAxiosInstance(provider);
  const body = toProviderBody({ ...req, stream: false });

  logger.debug('Sending chat completion', { provider, model: req.model });
  const res = await client.post('/v1/chat/completions', body);

  const data = res.data as {
    id: string;
    model: string;
    choices: Array<{
      message: { role: string; content: string; tool_calls?: unknown[] };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const choice = data.choices[0];
  return {
    id: data.id,
    model: data.model,
    message: {
      role: choice.message.role as 'assistant',
      content: choice.message.content,
    },
    finishReason: choice.finish_reason,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * Stream a chat completion, calling onChunk for each SSE delta.
 */
export async function streamChatCompletion(
  req: CanonicalRequest,
  onChunk: (chunk: string) => void,
  onDone: () => void
): Promise<void> {
  const provider = resolveProvider(req.model);
  const client = createAxiosInstance(provider);
  const body = toProviderBody({ ...req, stream: true });

  logger.debug('Starting streaming chat completion', { provider, model: req.model });

  const res = await client.post('/v1/chat/completions', body, {
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    const stream = res.data as NodeJS.ReadableStream;

    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          onChunk(trimmed.slice(6));
        }
      }
    });

    stream.on('end', () => {
      onDone();
      resolve();
    });

    stream.on('error', (err: Error) => {
      logger.error('Stream error', { error: err.message });
      reject(err);
    });
  });
}
