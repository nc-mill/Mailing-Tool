import { describe, expect, it, vi } from 'vitest';
import {
  assertNoConfigVarEndsWithApiKey,
  assertNoLeakedProviderKeys,
  leakedProviderEnvVars,
  warnOnLeakedEnvKeys,
} from './env-guard';

describe('kontrola prostředí', () => {
  it('na čistém prostředí nic nehlásí', () => {
    expect(leakedProviderEnvVars({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('najde ANTHROPIC_API_KEY, který v prostředí zůstal', () => {
    expect(leakedProviderEnvVars({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('prázdný řetězec nepovažuje za únik', () => {
    expect(leakedProviderEnvVars({ ANTHROPIC_API_KEY: '' })).toEqual([]);
  });

  it('najde i proměnné ostatních providerů a seřadí je', () => {
    expect(
      leakedProviderEnvVars({
        OPENROUTER_API_KEY: 'x',
        GOOGLE_GENERATIVE_AI_API_KEY: 'y',
        OPENAI_API_KEY: 'z',
      }),
    ).toEqual(['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']);
  });

  /**
   * Regrese na díru v první vrstvě. ANTHROPIC_AUTH_TOKEN nekončí na _API_KEY
   * a entrypoint P01 ho ve výčtu výjimek nemá, takže projde. Tahle vrstva ho
   * musí najít i tak. Kdyby někdo proměnnou z registru providerů odstranil,
   * spadne tenhle test.
   */
  it('najde ANTHROPIC_AUTH_TOKEN, který vzoru *_API_KEY neodpovídá', () => {
    expect(leakedProviderEnvVars({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-x' })).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
    ]);
  });

  it('dědí výčet výjimek z P01, takže zná i OLLAMA_HOST a HF_TOKEN', () => {
    expect(leakedProviderEnvVars({ OLLAMA_HOST: 'http://localhost:11434' })).toEqual([
      'OLLAMA_HOST',
    ]);
    expect(leakedProviderEnvVars({ HF_TOKEN: 'hf_x' })).toEqual(['HF_TOKEN']);
  });

  it('zaloguje warn s kódem ai_key_leaked_from_env a hodnotu klíče nikam nedá', () => {
    const warn = vi.fn();
    warnOnLeakedEnvKeys({ ANTHROPIC_API_KEY: 'sk-tajne' }, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.code).toBe('ai_key_leaked_from_env');
    expect(payload.variables).toEqual(['ANTHROPIC_API_KEY']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-tajne');
  });

  it('assertNoLeakedProviderKeys na čistém prostředí projde a vrátí prázdný seznam', () => {
    const warn = vi.fn();
    expect(assertNoLeakedProviderKeys({ NODE_ENV: 'production' }, { warn })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('assertNoLeakedProviderKeys při úniku varuje, ale běh NEZASTAVÍ', () => {
    const warn = vi.fn();
    // Zastavit start kvůli cizí proměnné by z bezpečnostní pojistky udělalo
    // výpadek dostupnosti: instalace s ANTHROPIC_API_KEY v prostředí by
    // nenaběhla vůbec, i kdyby AI vůbec nepoužívala. Klíč se ignoruje,
    // protože se bere výhradně z databáze, a fakt se zaloguje.
    expect(assertNoLeakedProviderKeys({ ANTHROPIC_API_KEY: 'sk-x' }, { warn })).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('kritérium 7c: žádný název konfigurační proměnné nekončí na _API_KEY', () => {
    expect(() =>
      assertNoConfigVarEndsWithApiKey(['SECRET_KEY', 'S3_ACCESS_KEY_ID', 'AI_ENABLED']),
    ).not.toThrow();
    expect(() => assertNoConfigVarEndsWithApiKey(['AI_PROVIDER_API_KEY'])).toThrow(
      /AI_PROVIDER_API_KEY/,
    );
  });
});
