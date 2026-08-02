import 'server-only';
import { createAiRuntime, type AiRuntime } from '@mlain/core/ai/runtime';
import { getConfig, getLogger } from '@/lib/runtime';

/**
 * Kompoziční kořen AI pro web proces. Sestavuje se jednou za proces, protože
 * jeho vedlejším účinkem je druhá vrstva kritéria 7b: kontrola, že klíče
 * providerů nezůstaly v prostředí. Kdyby si runtime skládal každý požadavek
 * sám, byla by z kontroly hlučná pravidelnost místo jednorázového zjištění.
 *
 * Volá se ze `instrumentation.ts` při startu serveru; ostatní kód si ho může
 * vyžádat odsud a dostane tutéž instanci.
 */
let cached: AiRuntime | null = null;

export function getAiRuntime(): AiRuntime {
  if (cached !== null) return cached;
  const config = getConfig();
  cached = createAiRuntime({
    env: process.env,
    logger: getLogger(),
    config: {
      requestTimeoutMs: config.AI_REQUEST_TIMEOUT_MS,
      allowCustomBaseUrl: config.AI_ALLOW_CUSTOM_BASE_URL,
    },
  });
  return cached;
}
