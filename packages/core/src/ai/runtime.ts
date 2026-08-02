import { buildModel, type DecryptedCredential, type ProviderHandle } from './build-model';
import { assertNoLeakedProviderKeys, type MinimalLogger } from './env-guard';
import { createMeteredFetch } from './metered-fetch';
import { factories as sdkFactories } from './sdk/factories';
import type { ProviderFactories } from './build-model';

export type AiRuntimeConfig = {
  requestTimeoutMs: number;
  allowCustomBaseUrl: boolean;
};

export type AiRuntimeInput = {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  logger: MinimalLogger;
  config: AiRuntimeConfig;
};

export type AiRuntime = {
  fetchImpl: typeof fetch;
  factories: ProviderFactories;
  buildModelFor: (credential: DecryptedCredential, modelId: string) => ProviderHandle;
};

/**
 * Jediné místo, kde se skládají skutečné závislosti vrstvy AI.
 *
 * Volá se právě dvakrát: jednou při startu web procesu a jednou při startu
 * workeru. Route handler ani job si runtime nesestavuje sám, aby kontrola
 * prostředí proběhla jednou a na jednom místě.
 */
export function createAiRuntime(input: AiRuntimeInput): AiRuntime {
  // DRUHÁ VRSTVA KRITÉRIA 7b, a jediné místo, kde se opravdu provádí.
  // Entrypoint (P01) proměnné maže; tohle ověří, že opravdu zmizely, i když
  // někdo spustí proces mimo entrypoint. Nezastavuje běh: klíč z prostředí se
  // stejně nikdy nepoužije, protože jediný zdroj klíče je databáze.
  assertNoLeakedProviderKeys(input.env, input.logger);

  const fetchImpl = createMeteredFetch({ timeoutMs: input.config.requestTimeoutMs });

  return {
    fetchImpl,
    factories: sdkFactories,
    buildModelFor: (credential, modelId) =>
      buildModel(credential, modelId, {
        fetchImpl,
        factories: sdkFactories,
        allowCustomBaseUrl: input.config.allowCustomBaseUrl,
      }),
  };
}
