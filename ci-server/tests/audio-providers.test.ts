import request from 'supertest';
import { appWithEnv, sendJson, startStub, Stub } from './helpers';

const AUTH = { Authorization: 'Bearer test-key' };
const NO_PROVIDERS = { OPENAI_API_KEY: '', STT_BASE_URL: '', TTS_BASE_URL: '' };

describe('speech-to-text routing', () => {
  let stt: Stub;
  beforeAll(async () => {
    stt = await startStub((_req, res) => sendJson(res, 200, { text: 'turn on the lights' }));
  });
  afterAll(() => stt.close());

  it('forwards multipart audio to STT_BASE_URL with the model override and key', async () => {
    const app = appWithEnv({
      ...NO_PROVIDERS,
      STT_BASE_URL: `${stt.url}/v1/`,
      STT_API_KEY: 'stt-secret',
      STT_MODEL: 'Systran/faster-distil-whisper-small.en',
    });
    const res = await request(app)
      .post('/v1/audio/transcriptions')
      .set(AUTH)
      .attach('file', Buffer.from('RIFF....WAVEfake'), { filename: 'a.wav', contentType: 'audio/wav' })
      .field('model', 'whisper-1')
      .field('language', 'en');

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('turn on the lights');
    const upstream = stt.requests[stt.requests.length - 1];
    // A trailing /v1 on the base URL is tolerated, not doubled.
    expect(upstream.url).toBe('/v1/audio/transcriptions');
    expect(upstream.headers.authorization).toBe('Bearer stt-secret');
    const body = upstream.body.toString('utf8');
    expect(body).toContain('Systran/faster-distil-whisper-small.en');
    expect(body).not.toContain('whisper-1');
    expect(body).toContain('name="language"');
    expect(body).toContain('RIFF....WAVEfake');
  });

  it('answers 503 stt_not_configured when no provider is set', async () => {
    const app = appWithEnv(NO_PROVIDERS);
    const res = await request(app)
      .post('/v1/audio/transcriptions')
      .set(AUTH)
      .attach('file', Buffer.from('RIFF'), { filename: 'a.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('stt_not_configured');
  });

  it('answers 502 when the STT server fails', async () => {
    const broken = await startStub((_req, res) => sendJson(res, 500, { error: 'boom' }));
    const app = appWithEnv({ ...NO_PROVIDERS, STT_BASE_URL: broken.url });
    const res = await request(app)
      .post('/v1/audio/transcriptions')
      .set(AUTH)
      .attach('file', Buffer.from('RIFF'), { filename: 'a.wav', contentType: 'audio/wav' });
    await broken.close();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('transcription_error');
  });
});

describe('text-to-speech routing', () => {
  const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary');
  let tts: Stub;
  beforeAll(async () => {
    tts = await startStub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(WAV);
    });
  });
  afterAll(() => tts.close());

  it('sends local voices and response_format to TTS_BASE_URL', async () => {
    const app = appWithEnv({ ...NO_PROVIDERS, TTS_BASE_URL: tts.url, TTS_MODEL: 'speaches-ai/Kokoro-82M-v1.0-ONNX' });
    const res = await request(app)
      .post('/v1/audio/speech')
      .set(AUTH)
      .send({ model: 'tts-1', input: 'Lights on.', voice: 'af_heart', response_format: 'wav' })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/wav');
    expect(Buffer.compare(res.body as Buffer, WAV)).toBe(0);
    expect(tts.requests[tts.requests.length - 1].json).toEqual({
      model: 'speaches-ai/Kokoro-82M-v1.0-ONNX',
      input: 'Lights on.',
      voice: 'af_heart',
      speed: 1,
      response_format: 'wav',
    });
  });

  it('still accepts the legacy `format` field', async () => {
    const app = appWithEnv({ ...NO_PROVIDERS, TTS_BASE_URL: tts.url });
    const res = await request(app)
      .post('/v1/audio/speech')
      .set(AUTH)
      .send({ input: 'hi', voice: 'alloy', format: 'flac' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/flac');
  });

  it('rejects voices OpenAI does not have when routing to OpenAI', async () => {
    const app = appWithEnv({ ...NO_PROVIDERS, OPENAI_API_KEY: 'sk-test' });
    const res = await request(app).post('/v1/audio/speech').set(AUTH).send({ input: 'hi', voice: 'af_heart' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_voice');
  });

  it('answers 503 tts_not_configured when no provider is set', async () => {
    const app = appWithEnv(NO_PROVIDERS);
    const res = await request(app).post('/v1/audio/speech').set(AUTH).send({ input: 'hi', voice: 'alloy' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('tts_not_configured');
  });
});
