import { normalizeChatRequest, normalizeResponsesRequest } from '../src/normalizers';

describe('normalizeChatRequest', () => {
  it('normalizes a basic chat request', () => {
    const body = {
      model: 'ollama:llama2',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ],
      stream: false,
    };
    const result = normalizeChatRequest(body);
    expect(result.model).toBe('ollama:llama2');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].content).toBe('Hello!');
    expect(result.stream).toBe(false);
    expect(result.requestId).toBeTruthy();
  });

  it('sets stream to true when provided', () => {
    const result = normalizeChatRequest({ model: 'test', messages: [], stream: true });
    expect(result.stream).toBe(true);
  });

  it('maps tools correctly', () => {
    const body = {
      model: 'test',
      messages: [],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    };
    const result = normalizeChatRequest(body);
    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0].name).toBe('get_weather');
  });

  it('maps params correctly', () => {
    const body = {
      model: 'test',
      messages: [],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
    };
    const result = normalizeChatRequest(body);
    expect(result.params.temperature).toBe(0.7);
    expect(result.params.topP).toBe(0.9);
    expect(result.params.maxTokens).toBe(100);
  });
});

describe('normalizeResponsesRequest', () => {
  it('normalizes a string input', () => {
    const body = {
      model: 'ollama:llama2',
      input: 'What is the weather?',
      instructions: 'Be brief.',
    };
    const result = normalizeResponsesRequest(body);
    expect(result.model).toBe('ollama:llama2');
    // System message from instructions + user message
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('Be brief.');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toBe('What is the weather?');
    expect(result.instructions).toBe('Be brief.');
  });

  it('normalizes an array input', () => {
    const body = {
      model: 'test',
      input: [
        { role: 'user', content: 'Turn on lights.' },
      ],
    };
    const result = normalizeResponsesRequest(body);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Turn on lights.');
  });

  it('sets conversationId from previous_response_id', () => {
    const body = {
      model: 'test',
      input: 'hello',
      previous_response_id: 'resp_abc123',
    };
    const result = normalizeResponsesRequest(body);
    expect(result.conversationId).toBe('resp_abc123');
  });
});
