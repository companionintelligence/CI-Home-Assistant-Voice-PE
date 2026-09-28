import http from 'http';
import { AddressInfo } from 'net';
import type { Application } from 'express';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json?: unknown;
}

export interface Stub {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

type StubHandler = (req: RecordedRequest, res: http.ServerResponse) => void;

/** Start a throwaway upstream (Ollama, speaches, Companion Memory, ...) on a random port. */
export async function startStub(handler: StubHandler): Promise<Stub> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const recorded: RecordedRequest = { method: req.method || '', url: req.url || '', headers: req.headers, body };
      if ((req.headers['content-type'] || '').includes('application/json') && body.length) {
        recorded.json = JSON.parse(body.toString('utf8'));
      }
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * config.ts reads the environment once at import time, so build each app in
 * its own module registry with the given overrides. An empty string stands in
 * for "unset" (dotenv never overrides a key already present in process.env).
 */
export function appWithEnv(env: Record<string, string>): Application {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  let app: Application | undefined;
  try {
    jest.isolateModules(() => {
      app = (require('../src/app') as typeof import('../src/app')).createApp();
    });
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return app as Application;
}

/** Wait for fire-and-forget work (memory turn saves) to land on a stub. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
