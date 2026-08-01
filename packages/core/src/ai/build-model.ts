import { ApiError } from '../errors/api-error';
import { getProvider, type ProviderId } from './providers';

declare const nonEmptyApiKey: unique symbol;
/**
 * Branded typ. Nelze ho vyrobit přiřazením `string`, jen průchodem `toApiKey`.
 * Pravidlo "nikdy nepředávej undefined" je tím vynucené typem, ne konvencí.
 */
export type NonEmptyApiKey = string & { readonly [nonEmptyApiKey]: true };

export function toApiKey(value: unknown): NonEmptyApiKey {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('ai_credential_missing');
  }
  return value as NonEmptyApiKey;
}

export type DecryptedCredential = {
  provider: ProviderId;
  apiKey: NonEmptyApiKey;
  baseUrl: string | null;
};

export type LanguageModelLike = unknown;
export type ProviderHandle = {
  model: LanguageModelLike;
  providerId: ProviderId;
  modelId: string;
};

type FactoryArgs = { apiKey: string; baseURL?: string; fetch: typeof fetch; name?: string };
export type ProviderFactories = {
  createAnthropic: (args: FactoryArgs) => (modelId: string) => LanguageModelLike;
  createOpenAI: (args: FactoryArgs) => (modelId: string) => LanguageModelLike;
  createGoogleGenerativeAI: (args: FactoryArgs) => (modelId: string) => LanguageModelLike;
  createOpenRouter: (args: FactoryArgs) => (modelId: string) => LanguageModelLike;
  createOpenAICompatible: (args: FactoryArgs) => (modelId: string) => LanguageModelLike;
};

export type BuildModelOptions = {
  fetchImpl: typeof fetch;
  factories: ProviderFactories;
  allowCustomBaseUrl?: boolean;
};

export function buildModel(
  credential: DecryptedCredential,
  modelId: string,
  options: BuildModelOptions,
): ProviderHandle {
  // 1) Klíč se ověří jako první. Kdyby se tovární funkce zavolala dřív,
  //    SDK by na prázdném klíči sáhlo po proměnné prostředí a projekt bez
  //    klíče by utrácel peníze provozovatele (kritérium 7b).
  const apiKey = toApiKey(credential.apiKey);

  const descriptor = getProvider(credential.provider);
  const allowCustomBaseUrl = options.allowCustomBaseUrl ?? true;

  let baseURL: string | undefined;
  if (descriptor.allowsBaseUrl && credential.baseUrl !== null && credential.baseUrl !== '') {
    if (!allowCustomBaseUrl) {
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: 'base_url',
            code: 'ai_custom_base_url_disabled',
            message: 'Vlastní adresa poskytovatele je v této instalaci zakázaná.',
          },
        ],
      });
    }
    baseURL = credential.baseUrl;
  }
  if (descriptor.requiresBaseUrl && baseURL === undefined) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'base_url',
          code: 'ai_base_url_required',
          message: 'Tento poskytovatel vyžaduje vlastní adresu.',
        },
      ],
    });
  }

  const args: FactoryArgs = { apiKey, fetch: options.fetchImpl };
  if (baseURL !== undefined) args.baseURL = baseURL;

  const { factories } = options;
  switch (credential.provider) {
    case 'anthropic':
      return {
        model: factories.createAnthropic(args)(modelId),
        providerId: 'anthropic',
        modelId,
      };
    case 'openai':
      return { model: factories.createOpenAI(args)(modelId), providerId: 'openai', modelId };
    case 'google':
      return {
        model: factories.createGoogleGenerativeAI(args)(modelId),
        providerId: 'google',
        modelId,
      };
    case 'openrouter':
      return {
        model: factories.createOpenRouter(args)(modelId),
        providerId: 'openrouter',
        modelId,
      };
    case 'openai_compatible':
      return {
        model: factories.createOpenAICompatible({ ...args, name: 'openai_compatible' })(modelId),
        providerId: 'openai_compatible',
        modelId,
      };
  }
}
