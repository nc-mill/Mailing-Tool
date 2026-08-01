import { z } from 'zod';

/**
 * Registr providerů. Databáze výčet neuzavírá schválně (2.4), protože Azure
 * OpenAI a AWS Bedrock jsou už teď v dohledu a `ALTER TABLE ... DROP CONSTRAINT`
 * u každé instalace kvůli novému provideru je špatná cena za nic.
 */
export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'openai_compatible',
] as const;

/** Připravené hodnoty bez tovární funkce. Přidat je znamená doplnit `PROVIDERS`. */
export const RESERVED_PROVIDER_IDS = ['azure', 'bedrock'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderDescriptor = {
  readonly id: ProviderId;
  /** Název pro UI. Nepřekládá se, je to obchodní jméno. */
  readonly label: string;
  /** Smí uživatel zadat vlastní `base_url`? */
  readonly allowsBaseUrl: boolean;
  /** Je `base_url` povinná? */
  readonly requiresBaseUrl: boolean;
  /** Umí provider vypsat seznam modelů? Řídí chování `GET /api/v1/ai/models`. */
  readonly hasModelListEndpoint: boolean;
  /**
   * Proměnné prostředí, po kterých SDK sáhne, když se klíč nepředá.
   * Entrypoint je maže (P01), `env-guard` kontroluje, že jsou opravdu pryč.
   */
  readonly fallbackEnvVars: readonly string[];
  /** Kam poslat uživatele pro klíč. Zobrazuje se v prázdném stavu obrazovky. */
  readonly signupUrl: string;
};

const PROVIDERS: Readonly<Record<ProviderId, ProviderDescriptor>> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    allowsBaseUrl: false,
    requiresBaseUrl: false,
    hasModelListEndpoint: true,
    fallbackEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    signupUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    allowsBaseUrl: false,
    requiresBaseUrl: false,
    hasModelListEndpoint: true,
    fallbackEnvVars: ['OPENAI_API_KEY'],
    signupUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    id: 'google',
    label: 'Google',
    allowsBaseUrl: false,
    requiresBaseUrl: false,
    hasModelListEndpoint: true,
    fallbackEnvVars: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    signupUrl: 'https://aistudio.google.com/app/apikey',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    allowsBaseUrl: true,
    requiresBaseUrl: false,
    hasModelListEndpoint: true,
    fallbackEnvVars: ['OPENROUTER_API_KEY'],
    signupUrl: 'https://openrouter.ai/keys',
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Kompatibilní s OpenAI',
    allowsBaseUrl: true,
    requiresBaseUrl: true,
    hasModelListEndpoint: false,
    fallbackEnvVars: [],
    signupUrl: '',
  },
};

export function isKnownProvider(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function getProvider(id: ProviderId): ProviderDescriptor {
  const descriptor = PROVIDERS[id];
  if (descriptor === undefined) {
    throw new Error(`Neznámý provider AI: ${String(id)}`);
  }
  return descriptor;
}

export function listProviders(): readonly ProviderDescriptor[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]);
}

/** Všechny proměnné prostředí, které nesmí po startu zůstat nastavené. */
export function allFallbackEnvVars(): readonly string[] {
  return [...new Set(PROVIDER_IDS.flatMap((id) => PROVIDERS[id].fallbackEnvVars))];
}

export const providerIdSchema = z.enum(PROVIDER_IDS);
