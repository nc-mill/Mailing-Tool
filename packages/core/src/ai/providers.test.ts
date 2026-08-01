import { describe, expect, it } from 'vitest';
import {
  PROVIDER_IDS,
  RESERVED_PROVIDER_IDS,
  getProvider,
  isKnownProvider,
  providerIdSchema,
} from './providers';

describe('registr providerů', () => {
  it('MVP 0 zná právě pět providerů', () => {
    expect([...PROVIDER_IDS]).toEqual([
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'openai_compatible',
    ]);
  });

  it('azure a bedrock jsou připravené hodnoty bez implementace', () => {
    expect([...RESERVED_PROVIDER_IDS]).toEqual(['azure', 'bedrock']);
    expect(isKnownProvider('azure')).toBe(false);
  });

  it('schéma odmítne hodnotu mimo registr', () => {
    const parsed = providerIdSchema.safeParse('mistral');
    expect(parsed.success).toBe(false);
  });

  it('base_url je povolená jen u openrouter a openai_compatible', () => {
    expect(getProvider('openrouter').allowsBaseUrl).toBe(true);
    expect(getProvider('openai_compatible').allowsBaseUrl).toBe(true);
    expect(getProvider('anthropic').allowsBaseUrl).toBe(false);
    expect(getProvider('openai').allowsBaseUrl).toBe(false);
    expect(getProvider('google').allowsBaseUrl).toBe(false);
  });

  it('openai_compatible base_url vyžaduje', () => {
    expect(getProvider('openai_compatible').requiresBaseUrl).toBe(true);
    expect(getProvider('openrouter').requiresBaseUrl).toBe(false);
  });

  it('u každého providera je uvedená proměnná prostředí, kterou SDK používá jako fallback', () => {
    for (const id of PROVIDER_IDS) {
      const provider = getProvider(id);
      expect(Array.isArray(provider.fallbackEnvVars)).toBe(true);
    }
    expect(getProvider('anthropic').fallbackEnvVars).toContain('ANTHROPIC_API_KEY');
    expect(getProvider('google').fallbackEnvVars).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('getProvider na neznámé hodnotě vyhodí, ne vrátí undefined', () => {
    expect(() => getProvider('mistral' as never)).toThrow(/mistral/);
  });
});
