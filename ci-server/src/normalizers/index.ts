import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalToolDefinition,
  CanonicalParams,
} from '../types';

/**
 * Message content may be a plain string or an array of typed parts
 * ({type: 'text' | 'input_text' | 'output_text', text}). Flatten to text.
 */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const text = (part as Record<string, unknown> | null)?.text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

/** Keep only string-valued metadata entries. */
function stringMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Adapter for the OpenAI Chat Completions format.
 * Maps { model, messages, tools, stream, ...params } → CanonicalRequest
 */
export function normalizeChatRequest(body: Record<string, unknown>): CanonicalRequest {
  const model = (body.model as string) || config.defaultModel;
  const stream = Boolean(body.stream);

  const messages: CanonicalMessage[] = ((body.messages as unknown[]) || []).map((m) => {
    const msg = m as Record<string, unknown>;
    return {
      role: msg.role as CanonicalMessage['role'],
      content: contentToText(msg.content),
      toolCallId: msg.tool_call_id as string | undefined,
      toolCalls: msg.tool_calls
        ? (msg.tool_calls as Array<Record<string, unknown>>).map((tc) => ({
            id: tc.id as string,
            name: ((tc.function as Record<string, unknown>)?.name as string) || '',
            arguments: ((tc.function as Record<string, unknown>)?.arguments as string) || '',
          }))
        : undefined,
    };
  });

  const tools: CanonicalToolDefinition[] | undefined = body.tools
    ? (body.tools as Array<Record<string, unknown>>).map((t) => {
        const fn = (t.function || t) as Record<string, unknown>;
        return {
          name: fn.name as string,
          description: (fn.description as string) || '',
          parameters: (fn.parameters as Record<string, unknown>) || {},
        };
      })
    : undefined;

  const params: CanonicalParams = {
    temperature: body.temperature as number | undefined,
    topP: body.top_p as number | undefined,
    maxTokens: (body.max_tokens || body.max_completion_tokens) as number | undefined,
    frequencyPenalty: body.frequency_penalty as number | undefined,
    presencePenalty: body.presence_penalty as number | undefined,
    stop: body.stop as string | string[] | undefined,
    seed: body.seed as number | undefined,
  };

  return {
    requestId: uuidv4(),
    model,
    messages,
    tools,
    params,
    stream,
    metadata: stringMetadata(body.metadata),
  };
}

/**
 * Adapter for the OpenAI Responses format.
 * Maps { model, input, instructions, stream, ...params } → CanonicalRequest
 */
export function normalizeResponsesRequest(body: Record<string, unknown>): CanonicalRequest {
  const model = (body.model as string) || config.defaultModel;
  const stream = Boolean(body.stream);
  const instructions = body.instructions as string | undefined;

  // input can be a string or array of message objects
  let messages: CanonicalMessage[] = [];
  if (typeof body.input === 'string') {
    messages = [{ role: 'user', content: body.input }];
  } else if (Array.isArray(body.input)) {
    messages = (body.input as Array<Record<string, unknown>>).map((m) => ({
      role: (m.role as CanonicalMessage['role']) || 'user',
      content: contentToText(m.content),
    }));
  }

  // Prepend system instructions if present
  if (instructions) {
    messages = [{ role: 'system', content: instructions }, ...messages];
  }

  const tools: CanonicalToolDefinition[] | undefined = body.tools
    ? (body.tools as Array<Record<string, unknown>>).map((t) => ({
        name: t.name as string,
        description: (t.description as string) || '',
        parameters: (t.parameters as Record<string, unknown>) || {},
      }))
    : undefined;

  const params: CanonicalParams = {
    temperature: body.temperature as number | undefined,
    topP: body.top_p as number | undefined,
    maxTokens: body.max_output_tokens as number | undefined,
    seed: body.seed as number | undefined,
  };

  return {
    requestId: uuidv4(),
    model,
    messages,
    instructions,
    tools,
    params,
    stream,
    conversationId: body.previous_response_id as string | undefined,
    metadata: stringMetadata(body.metadata),
  };
}
