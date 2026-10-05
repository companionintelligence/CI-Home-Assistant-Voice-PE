import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserReachability,
  buildEnv,
  curlChecks,
  envValue,
  generateSecret,
  interpretStatus,
  normalizeUrl,
  pipelineSlots,
  startCommands,
  validate,
} from '../public/config.js';

const SECRETS = { masterKey: 'a'.repeat(64), postgresPassword: 'b'.repeat(48), jwtSecret: 'c'.repeat(64) };

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

test('generateSecret returns hex of the requested length', () => {
  const secret = generateSecret(32);
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.notEqual(generateSecret(32), secret);
  assert.equal(generateSecret(4, (buf) => buf.fill(255)), 'ffffffff');
});

test('envValue quotes only when needed and strips newlines', () => {
  assert.equal(envValue('ollama:llama3.2'), 'ollama:llama3.2');
  assert.equal(envValue('https://m.example.com/api'), 'https://m.example.com/api');
  assert.equal(envValue('Be brief. Use "metric".'), '"Be brief. Use \\"metric\\"."');
  assert.equal(envValue('line one\nMASTER_API_KEY=pwned'), '"line one MASTER_API_KEY=pwned"');
});

test('buildEnv: Home Assistant speech keeps the file minimal', () => {
  const env = parseEnv(buildEnv({ model: 'ollama:qwen3:4b', speech: 'ha' }, SECRETS));
  assert.equal(env.MASTER_API_KEY, SECRETS.masterKey);
  assert.equal(env.POSTGRES_PASSWORD, SECRETS.postgresPassword);
  assert.equal(env.CI_MODEL, 'ollama:qwen3:4b');
  assert.equal(env.STT_BASE_URL, undefined);
  assert.equal(env.CI_MEMORY_URL, undefined);
  // Only the checker at ha.ci.computer needs to call the server from a browser.
  assert.equal(env.CORS_ORIGINS, 'https://ha.ci.computer');
});

test('buildEnv: local speech points both engines at speaches', () => {
  const env = parseEnv(buildEnv({ speech: 'local' }, SECRETS));
  assert.equal(env.STT_BASE_URL, 'http://speaches:8000');
  assert.equal(env.TTS_BASE_URL, 'http://speaches:8000');
  assert.equal(env.CI_TTS_VOICE, 'af_heart');
  assert.ok(env.CI_TTS_VOICES.split(',').includes('af_heart'));
});

test('buildEnv: memory needs both values and is normalized', () => {
  const env = parseEnv(
    buildEnv({ memoryUrl: 'memory.local/api/', memoryKey: 'k1', saveTurns: false }, SECRETS)
  );
  assert.equal(env.CI_MEMORY_URL, 'http://memory.local/api');
  assert.equal(env.CI_MEMORY_API_KEY, 'k1');
  assert.equal(env.CI_MEMORY_SAVE_TURNS, 'false');
  assert.equal(parseEnv(buildEnv({ memoryUrl: 'x' }, SECRETS)).CI_MEMORY_URL, undefined);
});

test('buildEnv: every key it writes is one the compose file reads', async () => {
  const { readFile } = await import('node:fs/promises');
  const compose = await readFile(new URL('../public/compose.yml', import.meta.url), 'utf8');
  const env = parseEnv(
    buildEnv({ speech: 'local', openaiKey: 'sk', memoryUrl: 'https://m/api', memoryKey: 'k' }, SECRETS)
  );
  for (const key of Object.keys(env)) {
    if (key === 'POSTGRES_PASSWORD') continue; // only the full repo stack runs Postgres
    assert.ok(compose.includes(`\${${key}`), `compose.yml never reads ${key}`);
  }
});

test('validate flags the common mistakes', () => {
  assert.deepEqual(validate({ model: 'ollama:llama3.2', speech: 'ha' }), {});
  assert.ok(validate({ model: 'llama3.2', speech: 'ha' }).model);
  assert.ok(validate({ model: 'ollama:x', speech: 'openai' }).openaiKey);
  assert.ok(validate({ model: 'openai:gpt-4o-mini', speech: 'ha' }).openaiKey);
  assert.ok(validate({ model: 'ollama:x', speech: 'ha', memoryUrl: 'https://m' }).memory);
});

test('startCommands pulls the model and speech models when needed', () => {
  const ha = startCommands({ model: 'ollama:llama3.2', speech: 'ha' });
  assert.ok(ha.includes('docker compose -f compose.yml up -d'));
  assert.ok(ha.some((c) => c.endsWith('ollama pull llama3.2')));
  assert.ok(ha.some((c) => c.includes('https://ha.ci.computer/compose.yml')));

  const local = startCommands({ model: 'openai:gpt-4o-mini', speech: 'local' });
  assert.ok(local.includes('docker compose -f compose.yml --profile local-audio up -d'));
  assert.ok(!local.some((c) => c.includes('ollama pull')));
  assert.equal(local.filter((c) => c.startsWith('curl -X POST http://localhost:8000/v1/models/')).length, 2);
});

test('pipelineSlots always names the Companion conversation agent', () => {
  assert.equal(pipelineSlots('ha')[0].pick, 'companion-conversation');
  assert.match(pipelineSlots('ha')[1].pick, /faster-whisper/);
  assert.equal(pipelineSlots('local')[1].pick, 'companion-stt');
  assert.equal(pipelineSlots('local')[2].pick, 'companion-tts');
});

test('normalizeUrl and browserReachability', () => {
  assert.equal(normalizeUrl(' 192.168.1.5:8080/ '), 'http://192.168.1.5:8080');
  assert.equal(normalizeUrl('https://voice.ts.net//'), 'https://voice.ts.net');
  assert.equal(browserReachability('https://voice.ts.net').ok, true);
  assert.equal(browserReachability('http://localhost:8080').ok, true);
  assert.equal(browserReachability('http://192.168.1.5:8080').ok, false);
  assert.equal(browserReachability('').ok, false);
});

test('curlChecks never embeds a key the person did not type', () => {
  const [health, status] = curlChecks('', '');
  assert.equal(health, 'curl http://localhost:8080/health');
  assert.match(status, /\$MASTER_API_KEY/);
});

test('interpretStatus maps a healthy server to all green', () => {
  const rows = interpretStatus(
    { status: 'ok', version: '1.1.0' },
    {
      version: '1.1.0',
      default_model: 'ollama:llama3.2',
      llm: { provider: 'ollama', ok: true },
      stt: { provider: 'local', model: 'Systran/faster-distil-whisper-small.en' },
      tts: { provider: 'local', model: null },
      memory: { enabled: true, recall: true, save_turns: true, ok: true },
    },
    200
  );
  assert.deepEqual(rows.map((r) => r.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
});

test('interpretStatus explains auth failures and missing pieces', () => {
  assert.equal(interpretStatus({ status: 'ok' }, null, 401)[1].state, 'fail');
  assert.equal(interpretStatus({ status: 'ok' }, null, 404)[1].state, 'warn');
  const rows = interpretStatus(
    { status: 'ok' },
    {
      default_model: 'ollama:llama3.2',
      llm: { provider: 'ollama', ok: false, error: 'connect ECONNREFUSED' },
      stt: { provider: 'none' },
      tts: { provider: 'none' },
      memory: { enabled: true, ok: false, error: 'Request failed with status code 401' },
    },
    200
  );
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.equal(byLabel['Language model'].state, 'fail');
  assert.match(byLabel['Language model'].detail, /ECONNREFUSED/);
  assert.equal(byLabel['Speech-to-text'].state, 'warn');
  assert.equal(byLabel['Companion Memory'].state, 'fail');
});

test('progress counts only the steps on the chosen path', async () => {
  const { progress, STEPS } = await import('../public/config.js');
  assert.deepEqual(progress('docker', {}), { done: 0, total: STEPS.docker.length });
  assert.deepEqual(progress('hub', { 'hub-install': true, files: true, ha: true }), { done: 2, total: 5 });
  assert.deepEqual(progress('nonsense', { choose: true }), { done: 1, total: 7 });
});

test('cleanHost and serverUrlForHost accept whatever people paste', async () => {
  const { cleanHost, serverUrlForHost } = await import('../public/config.js');
  assert.equal(cleanHost(' http://192.168.1.20:8080/health '), '192.168.1.20');
  assert.equal(cleanHost('homelab.local'), 'homelab.local');
  assert.equal(cleanHost(''), '');
  assert.equal(serverUrlForHost('homelab.local:10700'), 'http://homelab.local:8080');
  assert.equal(serverUrlForHost('  '), '');
});

test('model choices are valid tags, with one escape hatch', async () => {
  const { MODEL_CHOICES, validate } = await import('../public/config.js');
  const tags = MODEL_CHOICES.filter((m) => m.id !== 'custom');
  assert.ok(tags.length >= 2);
  for (const m of tags) assert.deepEqual(validate({ model: m.id, speech: 'ha' }), {}, m.id);
  assert.equal(MODEL_CHOICES.at(-1).id, 'custom');
  assert.equal(MODEL_CHOICES[0].id, 'ollama:llama3.2');
});

test('Home Assistant links use the My Home Assistant redirects', async () => {
  const { HA_LINKS } = await import('../public/config.js');
  assert.equal(HA_LINKS.addWyoming, 'https://my.home-assistant.io/redirect/config_flow_start/?domain=wyoming');
  assert.match(HA_LINKS.voiceAssistants, /\/redirect\/voice_assistants\/$/);
});

test('every step the page renders is on some path', async () => {
  const { readFile } = await import('node:fs/promises');
  const { STEPS } = await import('../public/config.js');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const onPage = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  const known = new Set([...STEPS.docker, ...STEPS.hub]);
  assert.deepEqual(onPage.filter((id) => !known.has(id)), []);
  for (const id of known) assert.ok(onPage.includes(id), `no step element for ${id}`);
  const doneBoxes = [...html.matchAll(/data-done="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...doneBoxes].sort(), [...onPage].sort());
});
