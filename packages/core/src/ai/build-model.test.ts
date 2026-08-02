import { describe, expect, it, vi } from 'vitest';
import { buildModel, toApiKey } from './build-model';

type FactoryArgs = { apiKey: string; baseURL?: string; fetch: typeof fetch; name?: string };

const factories = () => ({
  createAnthropic: vi.fn((_a: FactoryArgs) => (modelId: string) => ({
    modelId,
    provider: 'anthropic',
  })),
  createOpenAI: vi.fn((_a: FactoryArgs) => (modelId: string) => ({ modelId, provider: 'openai' })),
  createGoogleGenerativeAI: vi.fn((_a: FactoryArgs) => (modelId: string) => ({
    modelId,
    provider: 'google',
  })),
  createOpenRouter: vi.fn((_a: FactoryArgs) => (modelId: string) => ({
    modelId,
    provider: 'openrouter',
  })),
  createOpenAICompatible: vi.fn((_a: FactoryArgs) => (modelId: string) => ({
    modelId,
    provider: 'compat',
  })),
});

describe('buildModel', () => {
  it('prázdný klíč odmítne DŘÍV, než zavolá tovární funkci', () => {
    const f = factories();
    expect(() =>
      buildModel({ provider: 'anthropic', apiKey: '' as never, baseUrl: null }, 'claude-opus-5', {
        fetchImpl: fetch,
        factories: f,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
    expect(f.createAnthropic).not.toHaveBeenCalled();
  });

  it('undefined klíč odmítne stejně', () => {
    const f = factories();
    expect(() =>
      buildModel(
        { provider: 'anthropic', apiKey: undefined as never, baseUrl: null },
        'claude-opus-5',
        { fetchImpl: fetch, factories: f },
      ),
    ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
    expect(f.createAnthropic).not.toHaveBeenCalled();
  });

  it('klíč ze samých bílých znaků odmítne také', () => {
    const f = factories();
    expect(() =>
      buildModel({ provider: 'openai', apiKey: '   ' as never, baseUrl: null }, 'gpt-x', {
        fetchImpl: fetch,
        factories: f,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
    expect(f.createOpenAI).not.toHaveBeenCalled();
  });

  it('platný klíč předá tovární funkci explicitně, nikdy jako undefined', () => {
    const f = factories();
    const handle = buildModel(
      { provider: 'anthropic', apiKey: toApiKey('sk-ant-xyz'), baseUrl: null },
      'claude-opus-5',
      { fetchImpl: fetch, factories: f },
    );
    expect(f.createAnthropic).toHaveBeenCalledTimes(1);
    const args = f.createAnthropic.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(args.apiKey).toBe('sk-ant-xyz');
    expect(Object.hasOwn(args, 'apiKey')).toBe(true);
    expect(handle.providerId).toBe('anthropic');
    expect(handle.modelId).toBe('claude-opus-5');
  });

  it('baseUrl se u anthropicu ignoruje, protože ji provider nepovoluje', () => {
    const f = factories();
    buildModel(
      { provider: 'anthropic', apiKey: toApiKey('sk'), baseUrl: 'https://zlo.example' },
      'claude-opus-5',
      { fetchImpl: fetch, factories: f },
    );
    const args = f.createAnthropic.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(args.baseURL).toBeUndefined();
  });

  it('openai_compatible bez baseUrl je chyba validace', () => {
    const f = factories();
    expect(() =>
      buildModel({ provider: 'openai_compatible', apiKey: toApiKey('sk'), baseUrl: null }, 'm', {
        fetchImpl: fetch,
        factories: f,
      }),
    ).toThrowError(expect.objectContaining({ code: 'validation_failed' }));
  });

  it('vlastní baseUrl se zakáže, když AI_ALLOW_CUSTOM_BASE_URL je false', () => {
    const f = factories();
    expect(() =>
      buildModel(
        { provider: 'openai_compatible', apiKey: toApiKey('sk'), baseUrl: 'https://ok.example' },
        'm',
        { fetchImpl: fetch, factories: f, allowCustomBaseUrl: false },
      ),
    ).toThrowError(expect.objectContaining({ code: 'validation_failed' }));
  });

  it('toApiKey vrátí branded typ jen pro neprázdný řetězec', () => {
    expect(toApiKey('abc')).toBe('abc');
    expect(() => toApiKey('')).toThrow();
    expect(() => toApiKey('  ')).toThrow();
  });

  it('každý z pěti providerů má tovární funkci', () => {
    const f = factories();
    const cases = [
      ['anthropic', 'createAnthropic'],
      ['openai', 'createOpenAI'],
      ['google', 'createGoogleGenerativeAI'],
      ['openrouter', 'createOpenRouter'],
    ] as const;
    for (const [provider, factory] of cases) {
      buildModel({ provider, apiKey: toApiKey('sk'), baseUrl: null }, 'model-x', {
        fetchImpl: fetch,
        factories: f,
      });
      expect(f[factory]).toHaveBeenCalled();
    }
    buildModel(
      { provider: 'openai_compatible', apiKey: toApiKey('sk'), baseUrl: 'https://ok.example' },
      'model-x',
      { fetchImpl: fetch, factories: f },
    );
    expect(f.createOpenAICompatible).toHaveBeenCalled();
  });
});
