import {
  DEFAULTS,
  browserReachability,
  buildEnv,
  curlChecks,
  generateSecret,
  interpretStatus,
  normalizeUrl,
  pipelineSlots,
  startCommands,
  validate,
} from './config.js';

const $ = (id) => document.getElementById(id);

// ── LED ring ────────────────────────────────────────────────────────────────
// The Voice PE ring has 12 LEDs. It rests showing the "listening" arc in the
// Companion mark's three teals, and sweeps once on load unless motion is reduced.
const LEDS = 12;
const COLORS = ['var(--led-1)', 'var(--led-2)', 'var(--led-3)'];

function buildRing() {
  const ring = $('led-ring');
  if (!ring) return [];
  const leds = [];
  for (let i = 0; i < LEDS; i++) {
    const led = document.createElement('span');
    led.className = 'led';
    const angle = (i / LEDS) * 360;
    led.style.transform = `rotate(${angle}deg) translateY(-560%) `;
    ring.appendChild(led);
    leds.push(led);
  }
  return leds;
}

function paintRing(leds, head) {
  leds.forEach((led, i) => {
    const distance = (head - i + LEDS) % LEDS;
    const lit = distance < 3;
    led.classList.toggle('on', lit);
    led.style.color = lit ? COLORS[distance] : '';
    led.style.backgroundColor = lit ? COLORS[distance] : '';
  });
}

function startRing() {
  const leds = buildRing();
  if (!leds.length) return;
  paintRing(leds, 2);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  let head = 2;
  let steps = 0;
  const timer = setInterval(() => {
    head = (head + 1) % LEDS;
    paintRing(leds, head);
    steps += 1;
    if (steps >= LEDS * 2) {
      clearInterval(timer);
      paintRing(leds, 2);
    }
  }, 110);
}

// ── Setup generator ─────────────────────────────────────────────────────────
function newSecrets() {
  return {
    masterKey: generateSecret(32),
    postgresPassword: generateSecret(24),
    jwtSecret: generateSecret(32),
  };
}

let secrets = newSecrets();

function readOptions() {
  const form = $('config-form');
  const data = new FormData(form);
  return {
    model: String(data.get('model') || '').trim(),
    speech: String(data.get('speech') || 'ha'),
    openaiKey: String(data.get('openaiKey') || '').trim(),
    languages: String(data.get('languages') || 'en').replace(/\s+/g, ''),
    memoryUrl: String(data.get('memoryUrl') || '').trim(),
    memoryKey: String(data.get('memoryKey') || '').trim(),
    saveTurns: $('saveTurns').checked,
    instructions: String(data.get('instructions') || '').trim() || DEFAULTS.instructions,
  };
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function highlight(text) {
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('#')) return `<span class="c">${escapeHtml(line)}</span>`;
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith(' ')) {
        return `<span class="k">${escapeHtml(line.slice(0, eq))}</span>=${escapeHtml(line.slice(eq + 1))}`;
      }
      return escapeHtml(line);
    })
    .join('\n');
}

function showErrors(errors) {
  const pairs = [
    ['model', 'model-error', ['model']],
    ['openaiKey', 'openaiKey-error', ['openaiKey']],
    ['memory', 'memory-error', ['memoryUrl', 'memoryKey']],
  ];
  for (const [key, errorId, inputs] of pairs) {
    $(errorId).textContent = errors[key] || '';
    for (const input of inputs) $(input).setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  }
}

function render() {
  const options = readOptions();
  $('openai-field').hidden = !(options.speech === 'openai' || options.model.startsWith('openai:'));
  showErrors(validate(options));

  const env = buildEnv(options, secrets);
  $('env-output').innerHTML = highlight(env);
  $('env-output').dataset.raw = env;

  const cmds = startCommands(options).join('\n');
  $('cmd-output').innerHTML = highlight(cmds);
  $('cmd-output').dataset.raw = cmds;

  $('slots-body').innerHTML = pipelineSlots(options.speech)
    .map((row) => `<tr><td>${escapeHtml(row.slot)}</td><td>${escapeHtml(row.pick)}</td></tr>`)
    .join('');

  renderCurl();
}

function renderCurl() {
  const text = curlChecks($('serverUrl').value, '').join('\n');
  $('curl-output').textContent = text;
  $('curl-output').dataset.raw = text;
}

async function copyFrom(outputId, button) {
  const text = $(outputId).dataset.raw || $(outputId).textContent;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($(outputId));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = 'Selected, press Ctrl+C';
  }
  setTimeout(() => (button.textContent = label), 1800);
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Checker ─────────────────────────────────────────────────────────────────
async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, mode: 'cors', credentials: 'omit' });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function renderResults(rows) {
  $('check-results').innerHTML = rows
    .map(
      (row) =>
        `<li class="result ${row.state}"><span class="pill">${row.state === 'ok' ? 'ok' : row.state === 'warn' ? 'check' : 'fix'}</span>` +
        `<span class="result-label">${escapeHtml(row.label)}</span>` +
        `<span class="result-detail">${escapeHtml(row.detail)}</span></li>`
    )
    .join('');
}

async function runCheck(event) {
  event.preventDefault();
  const url = normalizeUrl($('serverUrl').value);
  const key = $('serverKey').value.trim();
  const notice = $('check-notice');
  const reach = browserReachability(url);
  renderCurl();
  if (!reach.ok) {
    notice.textContent = reach.reason;
    notice.className = 'notice warn';
    return;
  }
  notice.textContent = 'Checking…';
  notice.className = 'notice';
  $('check-run').disabled = true;

  try {
    let health = null;
    try {
      health = (await fetchJson(`${url}/health`)).body;
    } catch {
      renderResults([
        {
          label: 'ci-server is up',
          state: 'fail',
          detail: 'No answer. Check the address, that port 8080 is reachable, and that CORS_ORIGINS allows this page.',
        },
      ]);
      notice.textContent = '';
      return;
    }
    let status = null;
    let code = 0;
    if (key) {
      try {
        const res = await fetchJson(`${url}/v1/status`, { Authorization: `Bearer ${key}` });
        code = res.status;
        status = res.status === 200 ? res.body : null;
      } catch {
        code = 0;
      }
    } else {
      code = 401;
    }
    renderResults(interpretStatus(health, status, code));
    notice.textContent = key ? '' : 'Add your MASTER_API_KEY to see the full check.';
  } finally {
    $('check-run').disabled = false;
  }
}

// ── Wire up ─────────────────────────────────────────────────────────────────
function init() {
  startRing();
  $('instructions').value = DEFAULTS.instructions;

  $('config-form').addEventListener('input', render);
  $('config-form').addEventListener('change', render);
  $('config-form').addEventListener('submit', (e) => e.preventDefault());

  for (const radio of document.querySelectorAll('input[name="install"]')) {
    radio.addEventListener('change', () => {
      $('hub-note').hidden = !$('install-hub').checked;
    });
  }

  $('regen').addEventListener('click', () => {
    secrets = newSecrets();
    render();
  });
  $('copy-env').addEventListener('click', (e) => copyFrom('env-output', e.currentTarget));
  $('copy-cmds').addEventListener('click', (e) => copyFrom('cmd-output', e.currentTarget));
  $('copy-curl').addEventListener('click', (e) => copyFrom('curl-output', e.currentTarget));
  $('download-env').addEventListener('click', () => download('.env', $('env-output').dataset.raw));

  $('serverUrl').addEventListener('input', renderCurl);
  $('check-form').addEventListener('submit', runCheck);

  render();
}

init();
