import {
  DEFAULTS,
  MODEL_CHOICES,
  browserReachability,
  buildEnv,
  cleanHost,
  curlChecks,
  generateSecret,
  interpretStatus,
  normalizeUrl,
  pipelineSlots,
  progress,
  serverUrlForHost,
  startCommands,
  validate,
} from './config.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'ci-ha-voice-setup-v1';

// ── Saved progress (per viewer, never secrets) ─────────────────────────────
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* private window or blocked storage: the page still works */
  }
}

// ── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

// ── Hero light ring ─────────────────────────────────────────────────────────
// The Voice PE ring has 12 LEDs. It rests on the "listening" sweep and runs it
// twice on load (and once per finished step) unless motion is reduced.
const LEDS = 12;
let leds = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildRing() {
  const group = document.querySelector('.puck .ring');
  if (!group) return;
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < LEDS; i++) {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', (256 + 106 * Math.cos(a)).toFixed(1));
    c.setAttribute('cy', (256 + 106 * Math.sin(a)).toFixed(1));
    c.setAttribute('r', '11');
    c.setAttribute('class', 'led');
    group.appendChild(c);
    leds.push(c);
  }
  paintRing(1);
}

function paintRing(head) {
  const tail = [1, 0.85, 0.6, 0.35];
  leds.forEach((led, i) => {
    const d = (head - i + LEDS) % LEDS;
    if (d < tail.length) {
      led.classList.add('on');
      led.setAttribute('r', '12.5');
      led.style.fill = `rgba(223, 247, 241, ${tail[d]})`;
    } else {
      led.classList.remove('on');
      led.setAttribute('r', '10');
      led.style.fill = '';
    }
  });
}

let sweepTimer;
function sweep(turns = 2) {
  if (reducedMotion || !leds.length) return;
  clearInterval(sweepTimer);
  let head = 1;
  let steps = 0;
  sweepTimer = setInterval(() => {
    head = (head + 1) % LEDS;
    paintRing(head);
    if (++steps >= LEDS * turns) {
      clearInterval(sweepTimer);
      paintRing(1);
    }
  }, 90);
}

// ── Setup state ─────────────────────────────────────────────────────────────
const saved = loadSaved();
const state = {
  path: saved.path === 'hub' ? 'hub' : 'docker',
  done: saved.done && typeof saved.done === 'object' ? saved.done : {},
};

function newSecrets() {
  return { masterKey: generateSecret(32), postgresPassword: generateSecret(24), jwtSecret: generateSecret(32) };
}
let secrets = newSecrets();

function modelFromForm() {
  const choice = $('model-choice').value;
  return choice === 'custom' ? $('model').value.trim() : choice;
}

function readOptions() {
  const speech = document.querySelector('input[name="speech"]:checked')?.value || 'ha';
  const memoryOn = $('memory-on').checked;
  return {
    model: modelFromForm(),
    speech,
    openaiKey: $('openaiKey').value.trim(),
    languages: $('languages').value.replace(/\s+/g, '') || 'en',
    memoryUrl: memoryOn ? $('memoryUrl').value.trim() : '',
    memoryKey: memoryOn ? $('memoryKey').value.trim() : '',
    saveTurns: $('saveTurns').checked,
    instructions: $('instructions').value.trim() || DEFAULTS.instructions,
  };
}

function persist() {
  save({
    path: state.path,
    done: state.done,
    speech: document.querySelector('input[name="speech"]:checked')?.value,
    modelChoice: $('model-choice').value,
    model: $('model').value,
    host: $('host').value,
    languages: $('languages').value,
    instructions: $('instructions').value,
    memoryOn: $('memory-on').checked,
    saveTurns: $('saveTurns').checked,
  });
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
      if (eq > 0 && !line.startsWith(' ') && /^[A-Z_]+$/.test(line.slice(0, eq))) {
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
  // A model error lives inside "More options"; open it so the message is seen.
  if (errors.model) $('custom-model-field').closest('details').open = true;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderPath() {
  for (const radio of document.querySelectorAll('input[name="path"]')) radio.checked = radio.value === state.path;
  for (const step of document.querySelectorAll('.step')) {
    step.hidden = !step.dataset.path.split(' ').includes(state.path);
  }
  renderProgress();
}

function renderProgress() {
  const { done, total } = progress(state.path, state.done);
  $('progress-text').textContent = `${done} of ${total} done`;
  $('progress-fill').style.width = `${Math.round((done / total) * 100)}%`;
  for (const box of document.querySelectorAll('input[data-done]')) {
    const id = box.dataset.done;
    box.checked = Boolean(state.done[id]);
    box.closest('.step').classList.toggle('is-done', box.checked);
  }
}

function render() {
  const options = readOptions();
  const choice = MODEL_CHOICES.find((m) => m.id === $('model-choice').value) || MODEL_CHOICES[0];
  $('model-note').textContent = choice.note;
  $('custom-model-field').hidden = choice.id !== 'custom';
  $('openai-field').hidden = !(options.speech === 'openai' || options.model.startsWith('openai:'));
  $('memory-fields').hidden = !$('memory-on').checked;
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

  const host = cleanHost($('host').value);
  $('host-value').textContent = host || "your computer's address";
  $('copy-host').dataset.copy = host;
  // The page check cannot call a plain http address on the network, so only
  // pre-fill an address it can reach (localhost); otherwise the curl lines lead.
  if (!$('serverUrl').dataset.touched) {
    const guess = serverUrlForHost(host);
    $('serverUrl').value = browserReachability(guess).ok ? guess : '';
  }
  renderCurl();
  persist();
}

function renderCurl() {
  const text = curlChecks($('serverUrl').value || serverUrlForHost($('host').value), '').join('\n');
  $('curl-output').textContent = text;
  $('curl-output').dataset.raw = text;
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    toast('Select the text and copy it');
  }
}

function saveFile(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadCompose() {
  try {
    const res = await fetch('/compose.yml', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    saveFile('compose.yml', await res.text(), 'text/yaml');
    toast('Saved compose.yml');
  } catch {
    window.location.href = '/compose.yml';
  }
}

function markDone(id, value) {
  state.done[id] = value;
  renderProgress();
  persist();
  if (value) sweep(1);
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
  const label = { ok: 'ok', warn: 'check', fail: 'fix' };
  $('check-results').innerHTML = rows
    .map(
      (row) =>
        `<li class="result ${row.state}"><span class="pill">${label[row.state]}</span>` +
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
    let code = 401;
    if (key) {
      try {
        const res = await fetchJson(`${url}/v1/status`, { Authorization: `Bearer ${key}` });
        code = res.status;
        status = res.status === 200 ? res.body : null;
      } catch {
        code = 0;
      }
    }
    const rows = interpretStatus(health, status, code);
    renderResults(rows);
    notice.textContent = key ? '' : 'Add your MASTER_API_KEY to see the full check.';
    if (rows.every((r) => r.state === 'ok')) markDone('check', true);
  } finally {
    $('check-run').disabled = false;
  }
}

// ── Wire up ─────────────────────────────────────────────────────────────────
function restoreForm() {
  const select = $('model-choice');
  select.innerHTML = MODEL_CHOICES.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
  if (saved.modelChoice && MODEL_CHOICES.some((m) => m.id === saved.modelChoice)) select.value = saved.modelChoice;
  if (saved.model) $('model').value = saved.model;
  if (saved.speech) {
    const radio = document.querySelector(`input[name="speech"][value="${saved.speech}"]`);
    if (radio) radio.checked = true;
  }
  if (saved.host) $('host').value = saved.host;
  if (saved.languages) $('languages').value = saved.languages;
  $('instructions').value = saved.instructions || DEFAULTS.instructions;
  $('memory-on').checked = Boolean(saved.memoryOn);
  if (saved.saveTurns === false) $('saveTurns').checked = false;
}

function init() {
  buildRing();
  setTimeout(() => sweep(2), 500);
  restoreForm();

  for (const radio of document.querySelectorAll('input[name="path"]')) {
    radio.addEventListener('change', () => {
      state.path = radio.value;
      renderPath();
      persist();
    });
  }
  for (const box of document.querySelectorAll('input[data-done]')) {
    box.addEventListener('change', () => markDone(box.dataset.done, box.checked));
  }
  $('reset-progress').addEventListener('click', () => {
    state.done = {};
    renderProgress();
    persist();
    document.getElementById('setup').scrollIntoView();
  });

  const setup = document.getElementById('setup');
  setup.addEventListener('input', (e) => {
    if (e.target.closest('#check-form')) return;
    render();
  });
  setup.addEventListener('change', (e) => {
    if (e.target.closest('#check-form') || e.target.matches('input[data-done], input[name="path"]')) return;
    render();
  });
  $('config-form').addEventListener('submit', (e) => e.preventDefault());

  $('regen').addEventListener('click', () => {
    secrets = newSecrets();
    render();
    toast('New keys generated');
  });
  $('download-env').addEventListener('click', () => {
    saveFile('.env', $('env-output').dataset.raw);
    toast('Saved .env');
  });
  $('download-compose').addEventListener('click', downloadCompose);
  $('copy-env').addEventListener('click', () => copyText($('env-output').dataset.raw, '.env'));
  $('copy-cmds').addEventListener('click', () => copyText($('cmd-output').dataset.raw, 'commands'));
  $('copy-curl').addEventListener('click', () => copyText($('curl-output').dataset.raw, 'commands'));
  $('copy-host').addEventListener('click', () => {
    const host = $('copy-host').dataset.copy;
    if (host) copyText(host, 'host');
    else $('host').focus();
  });
  $('copy-port').addEventListener('click', () => copyText('10700', 'port'));

  $('serverUrl').addEventListener('input', () => {
    $('serverUrl').dataset.touched = '1';
    renderCurl();
  });
  $('check-form').addEventListener('submit', runCheck);

  renderPath();
  render();
}

init();
