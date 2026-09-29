import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { VERSION } from '../version';
import { checkMemory, memoryEnabled } from '../memory';
import { resolveSttProvider, resolveTtsProvider } from '../providers/audio';
import { resolveProvider } from '../providers';

const router = Router();

/**
 * Reachability, not a model check: any HTTP answer below 500 means the backend
 * is up. A 4xx (a 401 without a key, say) still counts and is noted in `error`.
 * Companion Hub's inference pool does serve GET /api/inference/pool/v1/models,
 * but the check does not depend on it.
 */
async function checkLlm(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await axios.get(`${config.ollamaBaseUrl}/v1/models`, {
      timeout: 2000,
      headers: config.llmApiKey ? { Authorization: `Bearer ${config.llmApiKey}` } : {},
      validateStatus: (status) => status < 500,
    });
    return { ok: true, ...(res.status >= 400 ? { error: `HTTP ${res.status} from /v1/models` } : {}) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * GET /v1/status
 * Authenticated setup check used by the ha.ci.computer setup page and by
 * operators: which providers are wired up and whether they answer. Never
 * returns secrets.
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const [llm, memory] = await Promise.all([
    resolveProvider(config.defaultModel) === 'ollama' ? checkLlm() : Promise.resolve({ ok: true }),
    memoryEnabled() ? checkMemory() : Promise.resolve({ ok: false, error: 'not configured' }),
  ]);

  res.json({
    version: VERSION,
    default_model: config.defaultModel,
    llm: { provider: resolveProvider(config.defaultModel), ...llm },
    stt: { provider: resolveSttProvider('whisper-1').kind, model: config.sttModel || null },
    tts: { provider: resolveTtsProvider().kind, model: config.ttsModel || null },
    memory: {
      enabled: memoryEnabled(),
      recall: memoryEnabled() && config.memoryRecall,
      save_turns: memoryEnabled() && config.memorySaveTurns,
      ...memory,
    },
  });
});

export default router;
