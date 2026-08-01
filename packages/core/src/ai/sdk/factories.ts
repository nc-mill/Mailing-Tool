import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ProviderFactories } from '../build-model';

/**
 * Jediné místo, kde se importují tovární funkce providerů. Signatury patří do
 * pravého sloupce tabulky 3.12.2a: mění se s balíčkem, ne rozhodnutím.
 *
 * Ověřeno 2026-08-02 proti nainstalovaným typům, ne podle paměti: všech pět
 * továren bere `apiKey`, `baseURL` a `fetch`, `createOpenAICompatible` navíc
 * vyžaduje `name` a `baseURL` povinně.
 */
export const factories: ProviderFactories = {
  createAnthropic: (args) => createAnthropic(args) as never,
  createOpenAI: (args) => createOpenAI(args) as never,
  createGoogleGenerativeAI: (args) => createGoogleGenerativeAI(args) as never,
  createOpenRouter: (args) => createOpenRouter(args) as never,
  /**
   * `baseURL` je v `OpenAICompatibleProviderSettings` verze 3 POVINNÉ. Dosadit
   * za chybějící adresu prázdný řetězec by znamenalo, že požadavek odejde na
   * relativní `/chat/completions` a selže až na síti. `buildModel` adresu
   * u tohohle providera vyžaduje (`requiresBaseUrl`), takže sem prázdná nikdy
   * nedorazí; kdyby přesto, spadne to hned a nahlas.
   */
  createOpenAICompatible: (args) => {
    if (args.baseURL === undefined || args.baseURL === '') {
      throw new Error('openai_compatible: base_url je povinná, model se bez ní nedá sestavit.');
    }
    return createOpenAICompatible({
      ...args,
      name: args.name ?? 'openai_compatible',
      baseURL: args.baseURL,
    }) as never;
  },
};
