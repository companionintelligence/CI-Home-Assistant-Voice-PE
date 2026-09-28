import request from 'supertest';
import { appWithEnv, sendJson, startStub } from './helpers';

const AUTH = { Authorization: 'Bearer test-key' };

describe('GET /v1/status', () => {
  it('requires auth', async () => {
    const res = await request(appWithEnv({})).get('/v1/status');
    expect(res.status).toBe(401);
  });

  it('reports providers and reachability without leaking secrets', async () => {
    const ollama = await startStub((_req, res) => sendJson(res, 200, { data: [] }));
    const memory = await startStub((_req, res) => sendJson(res, 200, { block: '' }));
    const app = appWithEnv({
      OLLAMA_BASE_URL: ollama.url,
      CI_MODEL: 'ollama:qwen3:4b',
      STT_BASE_URL: 'http://speaches:8000',
      STT_API_KEY: 'stt-secret',
      TTS_BASE_URL: '',
      OPENAI_API_KEY: '',
      CI_MEMORY_URL: memory.url,
      CI_MEMORY_API_KEY: 'mem-secret',
    });
    const res = await request(app).get('/v1/status').set(AUTH);
    await ollama.close();
    await memory.close();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: '1.1.0',
      default_model: 'ollama:qwen3:4b',
      llm: { provider: 'ollama', ok: true },
      stt: { provider: 'local' },
      tts: { provider: 'none' },
      memory: { enabled: true, recall: true, save_turns: true, ok: true },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret');
  });
});

describe('Private Network Access preflight', () => {
  it('allows the ha.ci.computer setup page to reach a private ci-server', async () => {
    const res = await request(appWithEnv({ CORS_ORIGINS: '*' }))
      .options('/v1/status')
      .set('Origin', 'https://ha.ci.computer')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
