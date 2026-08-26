import request from 'supertest';
import type { Application } from 'express';

/**
 * config.ts reads the environment once at import time, so each app under test
 * needs its own module registry to see a different MASTER_API_KEY.
 * An empty string stands in for "unset": dotenv never overrides a key that is
 * already present in process.env, so a stray .env cannot leak into the test.
 */
function appWithMasterKey(masterKey: string): Application {
  const previous = process.env.MASTER_API_KEY;
  process.env.MASTER_API_KEY = masterKey;
  let app: Application | undefined;
  jest.isolateModules(() => {
    app = (require('../src/app') as typeof import('../src/app')).createApp();
  });
  process.env.MASTER_API_KEY = previous;
  return app as Application;
}

describe('authMiddleware', () => {
  it('is not relying on NODE_ENV being production', () => {
    // The regression this suite guards: auth used to be skipped entirely
    // unless NODE_ENV === 'production'.
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('rejects a well-formed key that is not the master key', async () => {
    const app = appWithMasterKey('the-real-key');
    const res = await request(app).get('/v1/models').set({ Authorization: 'Bearer not-the-key' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('accepts the configured master key', async () => {
    const app = appWithMasterKey('the-real-key');
    const res = await request(app).get('/v1/models').set({ Authorization: 'Bearer the-real-key' });
    expect(res.status).toBe(200);
  });

  it('rejects a blank bearer token', async () => {
    const app = appWithMasterKey('the-real-key');
    const res = await request(app).get('/v1/models').set({ Authorization: 'Bearer   ' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('fails closed with 503 when no master key is configured', async () => {
    const app = appWithMasterKey('');
    const res = await request(app).get('/v1/models').set({ Authorization: 'Bearer anything' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('auth_not_configured');
  });

  it('fails closed even when no key is presented and none is configured', async () => {
    const app = appWithMasterKey('');
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('auth_not_configured');
  });
});
