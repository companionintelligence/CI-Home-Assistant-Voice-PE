// The voice path is published: two GHCR images, a Wyoming server on TCP 10700, a
// Hub store listing, the compose file at ha.ci.computer and the site itself.
// contracts/frozen-surfaces.json lists every value that must not change by
// accident, and this file checks each one against the file it was read from, so
// renaming a port, program name, env var, image name or public URL turns a test
// red. The two compose files and .env.example are also pinned by sha256, and the
// env var names are checked against the code that reads them. The /v1/status key
// set is pinned against the running facade in e2e/test_stack.py.
//
// To change a frozen value on purpose, edit the file and the JSON in the same
// pull request and say why in its description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { interpretStatus } from '../public/config.js';

const repoUrl = (path) => new URL(`../../${path}`, import.meta.url);
const text = (path) => readFile(repoUrl(path), 'utf8');
const yaml = async (path) => parse(await text(path));
const frozen = JSON.parse(await text('contracts/frozen-surfaces.json'));
const sorted = (list) => [...list].sort();

// Compose files: what people run today

for (const spec of Object.values(frozen.compose)) {
  test(`${spec.file}: service keys and published ports`, async () => {
    const { services } = await yaml(spec.file);
    assert.deepEqual(sorted(Object.keys(services)), sorted(Object.keys(spec.services)));
    for (const [name, want] of Object.entries(spec.services)) {
      assert.deepEqual((services[name]?.ports ?? []).map(String), want.ports, `${name} ports`);
    }
  });

  test(`${spec.file}: environment variable names`, async () => {
    const { services } = await yaml(spec.file);
    for (const [name, want] of Object.entries(spec.services)) {
      if (!services[name]) continue; // the service keys test reports a missing service
      assert.deepEqual(sorted(Object.keys(services[name].environment ?? {})), want.env, `${name} environment`);
    }
  });

  test(`${spec.file}: fixed values, images and profile`, async () => {
    const { services } = await yaml(spec.file);
    // A service that is missing altogether is reported by the service keys test.
    for (const [name, values] of Object.entries(spec.fixed_env)) {
      for (const [key, want] of Object.entries(values)) {
        if (services[name]) assert.equal(String(services[name].environment?.[key]), want, `${name} ${key}`);
      }
    }
    if (services.speaches) assert.deepEqual(services.speaches.profiles, [spec.speaches_profile]);
    for (const [name, context] of Object.entries(spec.build_contexts ?? {})) {
      if (services[name]) assert.equal(services[name].build?.context, context, `${name} build context`);
    }
    for (const [name, image] of Object.entries(spec.images ?? {})) {
      if (services[name]) assert.equal(services[name].image, image, `${name} image`);
    }
  });
}

test('.env.example: variable names', async () => {
  const names = [...(await text(frozen.env_example.file)).matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  assert.deepEqual(sorted(new Set(names)), frozen.env_example.names);
});

// The names above are only what the files pass in. Defaults, images, restart
// policies and comments are pinned by the hash of the raw bytes.
for (const [file, want] of Object.entries(frozen.frozen_files.sha256)) {
  test(`${file}: unchanged byte for byte`, async () => {
    const got = createHash('sha256').update(await readFile(repoUrl(file))).digest('hex');
    assert.equal(
      got,
      want,
      `${file} changed: sha256 is now ${got}, contracts/frozen-surfaces.json has ${want}. ` +
        'If the change is intended, update frozen_files.sha256 in the same pull request and say why.',
    );
  });
}

// Env vars: the code still reads every name the compose files pass in

// Full-line comments are dropped, so a name that only appears in a comment does not count as read.
const withoutComments = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/|\/\*|\*)/.test(line))
    .join('\n');

const READS = {
  process_env: (name) => new RegExp(`process\\.env(?:\\.${name}\\b|\\[\\s*(['"])${name}\\1\\s*\\])`),
  quoted_literal: (name) => new RegExp(`(['"])${name}\\1`),
};

async function sourceFiles(path) {
  if ((await stat(repoUrl(path))).isFile()) return [path];
  const entries = await readdir(repoUrl(path), { recursive: true });
  return entries.filter((entry) => entry.endsWith('.ts')).sort().map((entry) => `${path}/${entry}`);
}

test('env vars: the code still reads every name the compose files and .env.example pass in', async () => {
  const problems = [];
  const readers = [];
  for (const reader of frozen.env_readers.readers) {
    const files = await sourceFiles(reader.source);
    assert.notEqual(files.length, 0, `no source files under ${reader.source}`);
    const code = withoutComments((await Promise.all(files.map(text))).join('\n'));
    const reads = (name) => READS[reader.read_as](name).test(code);
    readers.push({ ...reader, reads });

    const passed = new Set(Object.values(frozen.compose).flatMap((spec) => spec.services[reader.service]?.env ?? []));
    for (const name of sorted(passed)) {
      if (!reads(name)) problems.push(`${name} is passed to ${reader.service} but ${reader.source} does not read it`);
    }
  }

  const elsewhere = new Set(frozen.env_readers.read_by_other_images);
  for (const name of frozen.env_example.names) {
    if (elsewhere.has(name)) continue;
    if (!readers.some((reader) => reader.reads(name))) {
      problems.push(`${name} is in ${frozen.env_example.file} but ${readers.map((reader) => reader.source).join(' and ')} do not read it`);
    }
  }
  // The allowlist is for names other images consume. It must not hide one of ours.
  for (const reader of readers) {
    for (const spec of Object.values(frozen.compose)) {
      for (const name of spec.services[reader.service]?.env ?? []) {
        if (elsewhere.has(name)) problems.push(`${name} is on read_by_other_images but ${reader.service} is passed it`);
      }
    }
  }
  assert.ok(problems.length === 0, `env var names drifted from the code that reads them:\n  ${problems.join('\n  ')}`);
});

// Wyoming: what Home Assistant connects to

test('wyoming: the bridge listens on TCP 10700 by default', async () => {
  const source = await text('voice-bridge/src/config.py');
  assert.equal(Number(source.match(/^\s*port:\s*int\s*=\s*(\d+)\s*$/m)?.[1]), frozen.wyoming.port);
});

test('wyoming: program names companion-stt, companion-tts and companion-conversation', async () => {
  const source = await text('voice-bridge/src/wyoming/info.py');
  const read = (constant) => source.match(new RegExp(`^${constant}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
  assert.deepEqual(
    { asr: read('STT_PROGRAM'), tts: read('TTS_PROGRAM'), handle: read('HANDLE_PROGRAM') },
    frozen.wyoming.programs,
  );
});

test('wyoming: zeroconf name companion-voice', async () => {
  const source = await text('voice-bridge/src/config.py');
  assert.equal(source.match(/^\s*zeroconf_name:\s*str\s*=\s*"([^"]+)"/m)?.[1], frozen.wyoming.zeroconf_name);
});

// Images: what compose.yml and the Hub listing pull

async function publishWorkflow() {
  const workflow = await yaml(frozen.images.workflow);
  const steps = workflow.jobs.publish.steps;
  const meta = steps.find((step) => step.id === 'meta');
  const build = steps.find((step) => String(step.uses).startsWith('docker/build-push-action@'));
  const tagLines = String(meta.with.tags).split('\n').map((line) => line.trim()).filter(Boolean);
  return { workflow, job: workflow.jobs.publish, meta, build, tagLines };
}

test('publish-images: GHCR image names and matrix contexts', async () => {
  const { job, meta, build } = await publishWorkflow();
  assert.deepEqual(job.strategy.matrix.include, frozen.images.matrix);
  assert.equal(meta.with.images, frozen.images.registry_prefix + '${{ matrix.image }}');
  assert.equal(build.with.context, '${{ matrix.context }}');
});

test('publish-images: OCI labels title, vendor and url', async () => {
  const { meta } = await publishWorkflow();
  const labels = Object.fromEntries(
    String(meta.with.labels)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  assert.deepEqual(labels, frozen.images.labels);
});

test('publish-images: runs only on v* tags and manual dispatch', async () => {
  const { workflow } = await publishWorkflow();
  assert.deepEqual(sorted(Object.keys(workflow.on)), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push, { tags: frozen.images.tag_trigger });
});

test('publish-images: the semver and sha tag rules are unchanged', async () => {
  const { tagLines } = await publishWorkflow();
  const others = tagLines.filter((line) => !line.startsWith('type=raw,value=latest'));
  assert.deepEqual(others, frozen.images.tag_rules);
});

// Release safety: latest and the dry run switch
//
// Just enough of the GitHub Actions expression language to evaluate the two
// conditions in publish-images.yml: string, number, boolean and null literals,
// context lookups, ! && || == != parentheses and startsWith and contains.
// Missing context properties are null and && and || return an operand, as in
// Actions.

function tokenize(source) {
  const pattern = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)|(&&|\|\||==|!=|[!(),]))/y;
  const tokens = [];
  while (pattern.lastIndex < source.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) {
      if (source.slice(start).trim() === '') break;
      throw new Error(`cannot parse expression near: ${source.slice(start)}`);
    }
    if (match[1] !== undefined) tokens.push({ kind: 'str', value: match[1].slice(1, -1).replaceAll("''", "'") });
    else if (match[2] !== undefined) tokens.push({ kind: 'num', value: Number(match[2]) });
    else if (match[3] !== undefined) tokens.push({ kind: 'id', value: match[3] });
    else tokens.push({ kind: 'op', value: match[4] });
  }
  return tokens;
}

const truthy = (value) => !(value === null || value === false || value === 0 || value === '' || Number.isNaN(value));

function looseEquals(a, b) {
  const kind = (value) => (value === null ? 'null' : typeof value);
  if (kind(a) === kind(b)) return typeof a === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const number = (value) =>
    value === null ? 0 : typeof value === 'boolean' ? Number(value) : typeof value === 'string' ? (value.trim() === '' ? 0 : Number(value)) : NaN;
  return number(a) === number(b);
}

const FUNCTIONS = {
  startswith: (value, prefix) => String(value).toLowerCase().startsWith(String(prefix).toLowerCase()),
  contains: (value, part) => String(value).toLowerCase().includes(String(part).toLowerCase()),
};

function evaluate(source, context) {
  const tokens = tokenize(source);
  let position = 0;
  const isOp = (value) => tokens[position]?.kind === 'op' && tokens[position].value === value;
  const expectOp = (value) => {
    if (!isOp(value)) throw new Error(`expected ${value} in: ${source}`);
    position += 1;
  };
  const lookup = (path) => path.split('.').reduce((node, key) => (node == null ? null : (node[key] ?? null)), context);

  function parseOr() {
    let value = parseAnd();
    while (isOp('||')) {
      position += 1;
      const right = parseAnd();
      value = truthy(value) ? value : right;
    }
    return value;
  }
  function parseAnd() {
    let value = parseEquality();
    while (isOp('&&')) {
      position += 1;
      const right = parseEquality();
      value = truthy(value) ? right : value;
    }
    return value;
  }
  function parseEquality() {
    let value = parseUnary();
    while (isOp('==') || isOp('!=')) {
      const op = tokens[position++].value;
      const equal = looseEquals(value, parseUnary());
      value = op === '==' ? equal : !equal;
    }
    return value;
  }
  function parseUnary() {
    if (isOp('!')) {
      position += 1;
      return !truthy(parseUnary());
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const token = tokens[position++];
    if (!token) throw new Error(`unexpected end of: ${source}`);
    if (token.kind === 'op' && token.value === '(') {
      const value = parseOr();
      expectOp(')');
      return value;
    }
    if (token.kind === 'str' || token.kind === 'num') return token.value;
    if (token.kind !== 'id') throw new Error(`unexpected ${token.value} in: ${source}`);
    if (token.value === 'true') return true;
    if (token.value === 'false') return false;
    if (token.value === 'null') return null;
    if (isOp('(')) {
      position += 1;
      const args = [];
      while (!isOp(')')) {
        args.push(parseOr());
        if (isOp(',')) position += 1;
      }
      expectOp(')');
      const fn = FUNCTIONS[token.value.toLowerCase()];
      if (!fn) throw new Error(`unsupported function ${token.value}`);
      return fn(...args);
    }
    return lookup(token.value);
  }

  const value = parseOr();
  if (position !== tokens.length) throw new Error(`trailing tokens in: ${source}`);
  return value;
}

// What ${{ }} renders into an action input.
const render = (value) => (value === null ? '' : String(value));

// The expression inside ${{ }}, or the plain value when the input has none.
const expressionOf = (value) => String(value).trim().match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)?.[1];

test('the expression evaluator follows the Actions rules this file relies on', () => {
  const context = { github: { ref: 'refs/heads/main' } };
  assert.equal(evaluate('!inputs.missing', context), true);
  assert.equal(evaluate("false || 'b'", context), 'b');
  assert.equal(evaluate("'a' && 'b'", context), 'b');
  assert.equal(evaluate("github.ref == 'refs/heads/main'", context), true);
  assert.equal(evaluate("startsWith(github.ref, 'REFS/')", context), true);
  assert.equal(evaluate("contains(github.ref, '-')", context), false);
  assert.equal(evaluate("!(true && contains('a-b', '-'))", context), false);
});

test('publish-images: dry_run is a boolean input that defaults to false, so a plain dispatch still pushes', async () => {
  const { workflow, build } = await publishWorkflow();
  const input = workflow.on.workflow_dispatch?.inputs?.dry_run;
  assert.equal(input?.type, 'boolean', 'dry_run must be a boolean input');
  assert.strictEqual(input?.default, false, 'dry_run must default to false');

  const expression = expressionOf(build.with.push);
  const pushes = (github, inputs) => render(expression === undefined ? build.with.push : evaluate(expression, { github, inputs }));

  const tag = { event_name: 'push', ref: 'refs/tags/v1.2.3' };
  const dispatch = { event_name: 'workflow_dispatch', ref: 'refs/heads/main' };
  assert.equal(pushes(tag, {}), 'true', 'a v* tag push must push');
  assert.equal(pushes(dispatch, { dry_run: input.default }), 'true', 'a dispatch with no inputs must push');
  assert.equal(pushes(dispatch, { dry_run: false }), 'true', 'dry_run=false must push');
  assert.equal(pushes(dispatch, { dry_run: true }), 'false', 'dry_run=true must not push');
});

test('publish-images: a prerelease tag does not move latest', async () => {
  const { tagLines } = await publishWorkflow();
  const rule = tagLines.find((line) => line.startsWith('type=raw,value=latest,enable='));
  assert.ok(rule, 'the latest tag rule is missing');
  const expression = expressionOf(rule.slice('type=raw,value=latest,enable='.length));
  assert.ok(expression, 'the latest rule must be an expression');
  const enabled = (ref) => render(evaluate(expression, { github: { ref }, inputs: {} }));

  assert.equal(enabled('refs/tags/v1.2.3'), 'true');
  assert.equal(enabled('refs/heads/main'), 'true');
  assert.equal(enabled('refs/tags/v1.2.3-rc.1'), 'false');
  assert.equal(enabled('refs/tags/v2.0.0-beta'), 'false');
  assert.equal(enabled('refs/heads/feature'), 'false');
  assert.equal(enabled('refs/tags/1.2.3'), 'false');
});

test('docs/releasing.md documents the rollback tag', async () => {
  assert.ok((await text('docs/releasing.md')).includes(frozen.images.rollback_tag));
});

// Hub store listing

test('store: the deep link to the ci-ha-voice listing', async () => {
  assert.ok(frozen.store.deep_link.endsWith(`#${frozen.store.id}`));
  assert.ok((await text('web/public/config.js')).includes(`HUB_INSTALL_URL = '${frozen.store.deep_link}'`));
  assert.ok((await text('web/public/index.html')).includes(`href="${frozen.store.deep_link}"`));
});

test('store: service names match the GHCR images and the Hub env names are still read', async () => {
  // The listing itself lives in CI-Marketplace. Its service names are the image names.
  assert.deepEqual(frozen.store.service_names, frozen.images.matrix.map((entry) => entry.image));
  const config = await text('ci-server/src/config.ts');
  for (const name of frozen.store.hub_env) {
    assert.ok(config.includes(name), `ci-server/src/config.ts no longer reads ${name}`);
  }
});

// Site: https://ha.ci.computer

test('site: title and the two strings deploy-web.yml greps for', async () => {
  const html = await text('web/public/index.html');
  assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], frozen.site.title);

  const deploy = await yaml('.github/workflows/deploy-web.yml');
  const smoke = deploy.jobs.deploy.steps.find((step) => step.name === 'Smoke test');
  const greps = [...String(smoke.run).matchAll(/grep -q "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(greps, frozen.site.deploy_web_greps);

  // The greps run against the live pages, so the pages must carry the strings.
  assert.ok(html.includes(greps[0]), `index.html no longer contains "${greps[0]}"`);
  assert.ok((await text('web/public/compose.yml')).includes(greps[1]), `compose.yml no longer contains "${greps[1]}"`);
});

test('site: Worker name and custom domain route', async () => {
  const toml = await text('web/wrangler.toml');
  assert.equal(toml.split(/^\[/m)[0].match(/^name\s*=\s*"([^"]+)"/m)?.[1], frozen.site.worker_name);
  const route = toml.split('[[routes]]')[1] ?? '';
  assert.equal(route.match(/^pattern\s*=\s*"([^"]+)"/m)?.[1], frozen.site.route.pattern);
  assert.equal(route.match(/^custom_domain\s*=\s*(true|false)/m)?.[1] === 'true', frozen.site.route.custom_domain);
});

test('site: /compose.yml is served inline as text/yaml and is never a redirect', async () => {
  const lines = (await text('web/public/_headers')).split(/\r?\n/);
  const start = lines.findIndex((line) => line === '/compose.yml');
  assert.notEqual(start, -1, '_headers has no /compose.yml block');
  const headers = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    headers[line.slice(0, line.indexOf(':')).trim()] = line.slice(line.indexOf(':') + 1).trim();
  }
  assert.deepEqual(headers, frozen.site.compose_headers);

  if (existsSync(repoUrl('web/public/_redirects'))) {
    assert.ok(!(await text('web/public/_redirects')).includes('/compose.yml'), '/compose.yml must not be redirected');
  }
});

test('site: localStorage key of the setup page', async () => {
  assert.ok((await text('web/public/app.js')).includes(`const STORE_KEY = '${frozen.site.local_storage_key}'`));
});

// Facade: /v1/status

test('status: /v1/status top level field names', async () => {
  const source = await text('ci-server/src/routes/status.ts');
  const start = source.indexOf('res.json({');
  assert.notEqual(start, -1, 'res.json({ ... }) not found in status.ts');
  const open = source.indexOf('{', start);
  let depth = 0;
  let close = open;
  for (; close < source.length; close += 1) {
    if (source[close] === '{') depth += 1;
    if (source[close] === '}' && --depth === 0) break;
  }
  const keys = [];
  depth = 0;
  for (const line of source.slice(open + 1, close).split('\n')) {
    if (depth === 0) {
      const key = line.match(/^\s*([A-Za-z_]\w*)\s*:/)?.[1];
      if (key) keys.push(key);
    }
    for (const char of line) depth += char === '{' ? 1 : char === '}' ? -1 : 0;
  }
  assert.deepEqual(sorted(keys), sorted(frozen.status.fields));
});

test('status: the setup checker reads the frozen /v1/status fields', () => {
  const status = {
    version: '1.1.0',
    default_model: 'ollama:llama3.2',
    llm: { provider: 'ollama', ok: true },
    stt: { provider: 'local', model: 'whisper-small' },
    tts: { provider: 'local', model: 'kokoro' },
    memory: { enabled: true, recall: true, save_turns: true, ok: true },
  };
  // The sample is built from the frozen names only.
  assert.deepEqual(sorted(Object.keys(status)), sorted(frozen.status.fields));
  for (const [name, spec] of Object.entries(frozen.status.nested)) {
    const keys = Object.keys(status[name]);
    assert.deepEqual(sorted(keys), sorted(spec.required), `${name} sample keys`);
  }

  const rows = interpretStatus({ status: 'ok', version: '1.1.0' }, status, 200);
  assert.deepEqual(
    rows.map((row) => [row.label, row.state, row.detail]),
    [
      ['ci-server is up', 'ok', 'version 1.1.0'],
      ['API key', 'ok', 'Accepted.'],
      ['Language model', 'ok', 'ollama:llama3.2 via ollama'],
      ['Speech-to-text', 'ok', 'local, whisper-small'],
      ['Text-to-speech', 'ok', 'local, kokoro'],
      ['Companion Memory', 'ok', 'Recall on, saving each exchange.'],
    ],
  );
});

// Memory, licence and distribution

test('memory: platform label ha-voice-pe in the facade default and the bridge request', async () => {
  const facade = await text('ci-server/src/config.ts');
  assert.equal(facade.match(/memoryPlatform:\s*process\.env\.CI_MEMORY_PLATFORM\s*\|\|\s*'([^']+)'/)?.[1], frozen.memory.platform);
  const bridge = await text('voice-bridge/src/client/ci_client.py');
  assert.equal(bridge.match(/"platform":\s*"([^"]+)"/)?.[1], frozen.memory.platform);
});

test('LICENSE.md line 3 (the PolyForm Required Notice) is unchanged byte for byte', async () => {
  assert.equal(frozen.license.required_notice_line, 3);
  const line = (await text(frozen.license.file)).split('\n')[frozen.license.required_notice_line - 1];
  assert.ok(
    Buffer.from(line, 'utf8').equals(Buffer.from(frozen.license.required_notice, 'utf8')),
    `LICENSE.md line 3 is now: ${JSON.stringify(line)}`,
  );
});

test('site: the Worker serves assets from ./public, the directory whose root holds .assetsignore', async () => {
  const toml = await text('web/wrangler.toml');
  const assets = toml.split(/^\[assets\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const directory = assets.match(/^directory\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(directory, frozen.site.assets_directory, 'web/wrangler.toml [assets] directory');

  // wrangler resolves the directory against web/ and reads .assetsignore from its root.
  const root = resolve(dirname(fileURLToPath(repoUrl('web/wrangler.toml'))), directory);
  const ignoreFile = fileURLToPath(repoUrl(frozen.assets_ignore.file));
  assert.equal(dirname(ignoreFile), root, `${frozen.assets_ignore.file} must sit at the root of the assets directory ${directory}`);
});

test('web/public/.assetsignore holds integration/ if and only if distribution_decided is false', async () => {
  assert.equal(typeof frozen.distribution_decided, 'boolean');
  const file = frozen.assets_ignore.file;
  const held = frozen.assets_ignore.held_out_line;
  // wrangler splits on \n and honours a BOM and CRLF, so those are stripped. Nothing else is:
  // a leading space makes a different pattern, so no line is trimmed.
  const raw = existsSync(repoUrl(file)) ? (await text(file)).replace(/^﻿/, '') : '';
  const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  assert.equal(
    lines.includes(held),
    frozen.distribution_decided === false,
    frozen.distribution_decided
      ? `distribution_decided is true, so ${file} must no longer list ${held}`
      : `${file} must have a line that is exactly ${JSON.stringify(held)} until distribution is decided`,
  );
  if (frozen.distribution_decided === false) {
    const reincluded = lines.filter((line) => line.startsWith('!'));
    assert.deepEqual(reincluded, [], `${file} must not re-include anything with ! until distribution is decided`);
  }
});
