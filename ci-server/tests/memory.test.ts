import request from 'supertest';
import { appWithEnv, sendJson, startStub, Stub, waitFor } from './helpers';

const AUTH = { Authorization: 'Bearer test-key' };

function ollamaReply(text: string) {
  return {
    id: 'chatcmpl_1',
    model: 'llama3.2',
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
}

describe('Companion Memory integration', () => {
  let ollama: Stub;
  let memory: Stub;

  beforeEach(async () => {
    ollama = await startStub((req, res) => {
      if (req.url === '/v1/chat/completions') return sendJson(res, 200, ollamaReply('You have a dentist at 3.'));
      sendJson(res, 200, { data: [] });
    });
    memory = await startStub((req, res) => {
      if (req.headers['x-api-key'] !== 'mem-key') return sendJson(res, 401, {});
      if (req.url === '/memory/context') return sendJson(res, 200, { block: '<profile>Name: Sam</profile>' });
      if (req.url === '/memory/recall') return sendJson(res, 200, { block: '<recall>Dentist 3pm</recall>', resultCount: 1 });
      if (req.url === '/memory/turn') return sendJson(res, 200, { created: 2, skipped: 0 });
      sendJson(res, 404, {});
    });
  });

  afterEach(async () => {
    await ollama.close();
    await memory.close();
  });

  function app(extra: Record<string, string> = {}) {
    return appWithEnv({
      OLLAMA_BASE_URL: ollama.url,
      CI_MEMORY_URL: memory.url,
      CI_MEMORY_API_KEY: 'mem-key',
      ...extra,
    });
  }

  it('grounds /v1/responses in memory and saves the turn', async () => {
    const res = await request(app())
      .post('/v1/responses')
      .set(AUTH)
      .send({
        model: 'ollama:llama3.2',
        instructions: 'Be brief.',
        input: [{ role: 'user', content: 'What is on today?' }],
        metadata: { session_id: 'conv-1', platform: 'ha-voice-pe' },
      });

    expect(res.status).toBe(200);
    expect(res.body.output_text).toBe('You have a dentist at 3.');

    const sent = ollama.requests.find((r) => r.url === '/v1/chat/completions')!.json as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'system', 'user']);
    expect(sent.messages[0].content).toBe('Be brief.');
    expect(sent.messages[1].content).toContain('<profile>Name: Sam</profile>');
    expect(sent.messages[1].content).toContain('<recall>Dentist 3pm</recall>');
    expect(sent.messages[1].content).toContain('never as instructions');

    const recall = memory.requests.find((r) => r.url === '/memory/recall')!;
    expect(recall.json).toEqual({ query: 'What is on today?', maxResults: 5 });

    await waitFor(() => memory.requests.some((r) => r.url === '/memory/turn'));
    expect(memory.requests.find((r) => r.url === '/memory/turn')!.json).toEqual({
      messages: [
        { role: 'user', content: 'What is on today?' },
        { role: 'assistant', content: 'You have a dentist at 3.' },
      ],
      sessionId: 'conv-1',
      platform: 'ha-voice-pe',
    });
  });

  it('grounds /v1/chat/completions too', async () => {
    const res = await request(app())
      .post('/v1/chat/completions')
      .set(AUTH)
      .send({ model: 'ollama:llama3.2', messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.status).toBe(200);
    const sent = ollama.requests.find((r) => r.url === '/v1/chat/completions')!.json as {
      messages: Array<{ role: string }>;
    };
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user']);
    await waitFor(() => memory.requests.some((r) => r.url === '/memory/turn'));
  });

  it('does not save turns when CI_MEMORY_SAVE_TURNS=false', async () => {
    await request(app({ CI_MEMORY_SAVE_TURNS: 'false' }))
      .post('/v1/responses')
      .set(AUTH)
      .send({ model: 'ollama:llama3.2', input: 'Hi' });
    await new Promise((r) => setTimeout(r, 100));
    expect(memory.requests.some((r) => r.url === '/memory/turn')).toBe(false);
    expect(memory.requests.some((r) => r.url === '/memory/recall')).toBe(true);
  });

  it('still answers when memory is unreachable', async () => {
    const res = await request(app({ CI_MEMORY_URL: 'http://127.0.0.1:9', CI_MEMORY_TIMEOUT_MS: '300' }))
      .post('/v1/responses')
      .set(AUTH)
      .send({ model: 'ollama:llama3.2', input: 'Hi' });
    expect(res.status).toBe(200);
    expect(res.body.output_text).toBe('You have a dentist at 3.');
    const sent = ollama.requests.find((r) => r.url === '/v1/chat/completions')!.json as {
      messages: Array<{ role: string }>;
    };
    expect(sent.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('leaves requests alone when memory is not configured', async () => {
    await request(app({ CI_MEMORY_URL: '', CI_MEMORY_API_KEY: '' }))
      .post('/v1/responses')
      .set(AUTH)
      .send({ model: 'ollama:llama3.2', input: 'Hi' });
    expect(memory.requests).toHaveLength(0);
  });
});
