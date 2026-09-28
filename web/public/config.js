// Pure setup logic for ha.ci.computer. No DOM access here, so it runs in the
// browser and under `node --test` alike.

export const SITE_URL = 'https://ha.ci.computer';
export const WYOMING_PORT = 10700;
export const API_PORT = 8080;

export const SPEECH_OPTIONS = {
  // Home Assistant keeps its own Whisper and Piper add-ons; Companion answers.
  ha: {
    label: 'Keep Home Assistant speech',
    stt: 'faster-whisper (Home Assistant add-on)',
    tts: 'Piper (Home Assistant add-on)',
  },
  // Everything runs through ci-server, with speaches bundled for local STT/TTS.
  local: {
    label: 'Local speech with speaches',
    stt: 'companion-stt',
    tts: 'companion-tts',
  },
  // ci-server forwards speech to OpenAI.
  openai: {
    label: 'OpenAI speech',
    stt: 'companion-stt',
    tts: 'companion-tts',
  },
};

export const HUB_INSTALL_URL = 'https://hub.ci.computer/install#ci-ha-voice';

// My Home Assistant redirects open the viewer's own Home Assistant on the right screen.
export const HA_LINKS = {
  addWyoming: 'https://my.home-assistant.io/redirect/config_flow_start/?domain=wyoming',
  voiceAssistants: 'https://my.home-assistant.io/redirect/voice_assistants/',
  devices: 'https://my.home-assistant.io/redirect/devices/',
};

// Small models answer fastest, which matters more for voice than for chat.
export const MODEL_CHOICES = [
  { id: 'ollama:llama3.2', label: 'Llama 3.2, 3B', note: 'Smallest and fastest. A good first choice.' },
  { id: 'ollama:gemma3:4b', label: 'Gemma 3, 4B', note: 'Natural phrasing, still quick.' },
  { id: 'ollama:llama3.1:8b', label: 'Llama 3.1, 8B', note: 'Better answers. Needs more memory and a faster machine.' },
  { id: 'custom', label: 'Something else', note: 'Enter any Ollama, OpenAI or vLLM model tag under More options.' },
];

// The steps each path walks through, in order.
export const STEPS = {
  docker: ['choose', 'memory', 'files', 'start', 'ha', 'pipeline', 'check'],
  hub: ['hub-install', 'hub-memory', 'ha', 'pipeline', 'check'],
};

/** How far along a path is, given a map of step id to done. */
export function progress(path, done) {
  const steps = STEPS[path] || STEPS.docker;
  const count = steps.filter((id) => Boolean(done?.[id])).length;
  return { done: count, total: steps.length };
}

/** A host someone typed ("http://192.168.1.20:8080/") reduced to "192.168.1.20". */
export function cleanHost(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

/** The ci-server address on a host, for the checker and curl lines. */
export function serverUrlForHost(host) {
  const h = cleanHost(host);
  return h ? `http://${h}:${API_PORT}` : '';
}

export const SPEACHES_STT_MODEL = 'Systran/faster-distil-whisper-small.en';
export const SPEACHES_TTS_MODEL = 'speaches-ai/Kokoro-82M-v1.0-ONNX';
export const SPEACHES_VOICES = ['af_heart', 'af_bella', 'am_adam', 'bf_emma'];

export const DEFAULTS = {
  model: 'ollama:llama3.2',
  speech: 'ha',
  languages: 'en',
  openaiKey: '',
  memoryUrl: '',
  memoryKey: '',
  saveTurns: true,
  instructions: 'You are a concise smart home voice assistant. Answer in one or two sentences.',
};

/** Hex secret from a CSPRNG. `rng(bytes)` must fill and return a Uint8Array. */
export function generateSecret(bytes = 32, rng = defaultRng) {
  return Array.from(rng(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultRng(buf) {
  return globalThis.crypto.getRandomValues(buf);
}

/** Values in a .env line must not break the file. Quote anything with spaces or #. */
export function envValue(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (text === '' || /^[\w@%+=:,./-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Base URL a person pasted, cleaned: no trailing slash, scheme added when missing. */
export function normalizeUrl(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  return text.replace(/\/+$/, '');
}

export function validate(options) {
  const errors = {};
  if (!/^(ollama|openai|vllm):\S+$/.test(options.model || '')) {
    errors.model = 'Start the model with ollama:, openai: or vllm:, for example ollama:llama3.2.';
  }
  if (options.speech === 'openai' && !options.openaiKey) {
    errors.openaiKey = 'OpenAI speech needs an OpenAI API key.';
  }
  if (options.model?.startsWith('openai:') && !options.openaiKey) {
    errors.openaiKey = 'An openai: model needs an OpenAI API key.';
  }
  if (Boolean(options.memoryUrl) !== Boolean(options.memoryKey)) {
    errors.memory = 'Companion Memory needs both the address and a memory API key.';
  }
  if (options.memoryUrl && !/^https?:\/\/\S+$/i.test(normalizeUrl(options.memoryUrl))) {
    errors.memory = 'Enter the Companion Memory address as a URL, for example https://memory.example.com/api.';
  }
  return errors;
}

/**
 * The .env file for `docker compose up`. `secrets` carries generated values
 * so re-rendering on every keystroke does not rotate them.
 */
export function buildEnv(options, secrets) {
  const o = { ...DEFAULTS, ...options };
  const lines = [
    '# Companion Voice for Home Assistant',
    '# Generated at https://ha.ci.computer. Keep this file private.',
    '',
    '# Shared secret between the voice bridge and ci-server',
    `MASTER_API_KEY=${secrets.masterKey}`,
    `POSTGRES_PASSWORD=${secrets.postgresPassword}`,
    `JWT_SECRET=${secrets.jwtSecret}`,
    '',
    '# Language model',
    `CI_MODEL=${envValue(o.model)}`,
    `SYSTEM_INSTRUCTIONS=${envValue(o.instructions)}`,
    `LANGUAGES=${envValue(o.languages || 'en')}`,
    '',
  ];

  if (o.speech === 'local') {
    lines.push(
      '# Speech: bundled speaches container (docker compose --profile local-audio)',
      'STT_BASE_URL=http://speaches:8000',
      `STT_MODEL=${SPEACHES_STT_MODEL}`,
      'TTS_BASE_URL=http://speaches:8000',
      `TTS_MODEL=${SPEACHES_TTS_MODEL}`,
      `CI_TTS_VOICE=${SPEACHES_VOICES[0]}`,
      `CI_TTS_VOICES=${SPEACHES_VOICES.join(',')}`,
      ''
    );
  } else if (o.speech === 'openai') {
    lines.push('# Speech: OpenAI Whisper and TTS through ci-server', 'CI_TTS_VOICE=alloy', 'CI_TTS_VOICES=alloy,nova,echo,shimmer', '');
  } else {
    lines.push('# Speech: Home Assistant keeps its own Whisper and Piper add-ons', '');
  }

  if (o.openaiKey) lines.push(`OPENAI_API_KEY=${envValue(o.openaiKey)}`, '');

  if (o.memoryUrl && o.memoryKey) {
    lines.push(
      '# Companion Memory: ground answers in your memory and save each exchange',
      `CI_MEMORY_URL=${envValue(normalizeUrl(o.memoryUrl))}`,
      `CI_MEMORY_API_KEY=${envValue(o.memoryKey)}`,
      'CI_MEMORY_RECALL=true',
      `CI_MEMORY_SAVE_TURNS=${o.saveTurns ? 'true' : 'false'}`,
      ''
    );
  }

  lines.push('# Lets the checker at https://ha.ci.computer reach this server', 'CORS_ORIGINS=*', '');
  return lines.join('\n');
}

/** Shell commands to bring the stack up, in order. */
export function startCommands(options) {
  const o = { ...DEFAULTS, ...options };
  const cmds = [
    'mkdir companion-voice && cd companion-voice',
    `curl -fsSLO ${SITE_URL}/compose.yml`,
    '# save the .env above into this folder, then:',
    o.speech === 'local' ? 'docker compose -f compose.yml --profile local-audio up -d' : 'docker compose -f compose.yml up -d',
  ];
  if (o.model.startsWith('ollama:')) {
    cmds.push(`docker compose -f compose.yml exec ollama ollama pull ${o.model.slice('ollama:'.length)}`);
  }
  if (o.speech === 'local') {
    cmds.push(
      `curl -X POST http://localhost:8000/v1/models/${SPEACHES_STT_MODEL}`,
      `curl -X POST http://localhost:8000/v1/models/${SPEACHES_TTS_MODEL}`
    );
  }
  return cmds;
}

/** What to pick in each slot of the Home Assistant Assist pipeline. */
export function pipelineSlots(speech) {
  const s = SPEECH_OPTIONS[speech] || SPEECH_OPTIONS.ha;
  return [
    { slot: 'Conversation agent', pick: 'companion-conversation' },
    { slot: 'Speech-to-text', pick: s.stt },
    { slot: 'Text-to-speech', pick: s.tts },
    { slot: 'Wake word', pick: 'On the device (Voice PE handles "Okay Nabu")' },
  ];
}

/** curl commands a person can run on their own network. */
export function curlChecks(serverUrl, apiKey) {
  const url = normalizeUrl(serverUrl) || `http://localhost:${API_PORT}`;
  const key = apiKey ? apiKey : '$MASTER_API_KEY';
  return [
    `curl ${url}/health`,
    `curl -H "Authorization: Bearer ${key}" ${url}/v1/status`,
  ];
}

/** Can a page served from https://ha.ci.computer fetch this URL at all? */
export function browserReachability(serverUrl) {
  const url = normalizeUrl(serverUrl);
  if (!url) return { ok: false, reason: 'Enter the address of your ci-server.' };
  if (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(url)) {
    return {
      ok: false,
      reason:
        'Browsers block an https page from calling a plain http address on your network. ' +
        'Serve ci-server over https (Tailscale Serve or a Cloudflare Tunnel both work), or run the curl commands below instead.',
    };
  }
  return { ok: true, reason: '' };
}

/**
 * Turn /health and /v1/status answers into rows for the checker.
 * state is one of ok | warn | fail.
 */
export function interpretStatus(health, status, statusCode) {
  const rows = [];
  rows.push(
    health && health.status === 'ok'
      ? { label: 'ci-server is up', state: 'ok', detail: `version ${health.version || 'unknown'}` }
      : { label: 'ci-server is up', state: 'fail', detail: 'No answer from /health.' }
  );

  if (statusCode === 401) {
    rows.push({ label: 'API key', state: 'fail', detail: 'ci-server rejected the key. Use the MASTER_API_KEY from your .env.' });
    return rows;
  }
  if (statusCode === 503) {
    rows.push({ label: 'API key', state: 'fail', detail: 'MASTER_API_KEY is not set on ci-server.' });
    return rows;
  }
  if (statusCode === 404) {
    rows.push({ label: 'API key', state: 'warn', detail: 'This ci-server is older than 1.1 and has no /v1/status. Update it to see the full check.' });
    return rows;
  }
  if (!status) {
    rows.push({ label: 'API key', state: 'fail', detail: 'Could not read /v1/status.' });
    return rows;
  }

  rows.push({ label: 'API key', state: 'ok', detail: 'Accepted.' });
  rows.push(
    status.llm?.ok
      ? { label: 'Language model', state: 'ok', detail: `${status.default_model} via ${status.llm.provider}` }
      : { label: 'Language model', state: 'fail', detail: `${status.llm?.provider || 'provider'} did not answer: ${status.llm?.error || 'unknown error'}` }
  );

  const speech = (kind, name) =>
    status[kind]?.provider && status[kind].provider !== 'none'
      ? { label: name, state: 'ok', detail: `${status[kind].provider}${status[kind].model ? `, ${status[kind].model}` : ''}` }
      : { label: name, state: 'warn', detail: 'Not configured. Fine if Home Assistant keeps its own Whisper and Piper.' };
  rows.push(speech('stt', 'Speech-to-text'), speech('tts', 'Text-to-speech'));

  const m = status.memory || {};
  if (!m.enabled) {
    rows.push({ label: 'Companion Memory', state: 'warn', detail: 'Not connected. Answers will not use your memory.' });
  } else if (m.ok) {
    rows.push({ label: 'Companion Memory', state: 'ok', detail: m.save_turns ? 'Recall on, saving each exchange.' : 'Recall on, not saving exchanges.' });
  } else {
    rows.push({ label: 'Companion Memory', state: 'fail', detail: `Configured but unreachable: ${m.error || 'unknown error'}` });
  }
  return rows;
}
