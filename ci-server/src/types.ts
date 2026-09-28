/**
 * Canonical request/response structures used internally.
 * All adapters normalize to these before dispatching to providers.
 */

export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: CanonicalToolCall[];
}

export interface CanonicalToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CanonicalParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  seed?: number;
}

export interface CanonicalRequest {
  tenantId?: string;
  userId?: string;
  conversationId?: string;
  requestId: string;
  model: string;
  messages: CanonicalMessage[];
  instructions?: string;
  tools?: CanonicalToolDefinition[];
  params: CanonicalParams;
  stream: boolean;
  /** Free-form string metadata from the client (e.g. session_id, platform). */
  metadata?: Record<string, string>;
}

export interface CanonicalDelta {
  content?: string;
  toolCalls?: CanonicalToolCall[];
  finishReason?: string;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  message?: CanonicalMessage;
  delta?: CanonicalDelta;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string;
  };
}

export function makeOpenAIError(
  message: string,
  type: string,
  code: string,
  param: string | null = null
): OpenAIError {
  return { error: { message, type, param, code } };
}
