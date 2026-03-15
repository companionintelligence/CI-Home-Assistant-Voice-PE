import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const AUTH = { Authorization: 'Bearer test-key' };

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /v1/models', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(401);
  });

  it('returns model list with auth (degrades gracefully)', async () => {
    const res = await request(app).get('/v1/models').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /v1/chat/completions', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/chat/completions').send({ model: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when model is missing', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set(AUTH)
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_required_parameter');
  });
});

describe('POST /v1/responses', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/responses').send({ model: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when model is missing', async () => {
    const res = await request(app)
      .post('/v1/responses')
      .set(AUTH)
      .send({ input: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_required_parameter');
  });
});

describe('POST /v1/audio/transcriptions', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/audio/transcriptions');
    expect(res.status).toBe(401);
  });

  it('returns 400 when file is missing', async () => {
    const res = await request(app)
      .post('/v1/audio/transcriptions')
      .set(AUTH)
      .field('model', 'whisper-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_file');
  });
});

describe('POST /v1/audio/speech', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/audio/speech').send({ input: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when input is missing', async () => {
    const res = await request(app)
      .post('/v1/audio/speech')
      .set(AUTH)
      .send({ model: 'tts-1', voice: 'alloy' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_required_parameter');
  });

  it('returns 400 for unsupported format', async () => {
    const res = await request(app)
      .post('/v1/audio/speech')
      .set(AUTH)
      .send({ model: 'tts-1', input: 'hello', voice: 'alloy', format: 'ogg' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_format');
  });

  it('returns 400 for unsupported voice', async () => {
    const res = await request(app)
      .post('/v1/audio/speech')
      .set(AUTH)
      .send({ model: 'tts-1', input: 'hello', voice: 'invalid-voice', format: 'mp3' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_voice');
  });
});
