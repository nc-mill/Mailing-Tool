import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModel, toApiKey, type ProviderFactories } from './build-model';
import { prepareConversation, type PrepareDeps } from './chat';
import { createMeteredFetch } from './metered-fetch';

/**
 * Akceptační kritérium 7b, měřené, ne popsané.
 *
 * „Kontejner neodešle požadavek na cizí AI endpoint, dokud projekt nemá vlastní
 * nakonfigurovaný klíč." Tenhle soubor to neověřuje čtením kódu, ale POČÍTÁNÍM
 * odchozích volání: každá cesta, kudy by požadavek mohl odejít, dostane
 * špionážní `fetch` a na konci se kontroluje, že se nezavolal ANI JEDNOU.
 *
 * Plán má tutéž kontrolu v úkolu 32 na úrovni kontejneru. Tahle je o vrstvu
 * níž a chytí totéž o dvacet úkolů dřív.
 */
describe('kritérium 7b: bez klíče projektu neodejde žádný požadavek', () => {
  let outboundCalls: string[];
  let spyFetch: typeof fetch;

  beforeEach(() => {
    outboundCalls = [];
    spyFetch = vi.fn(async (input: unknown) => {
      outboundCalls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Tovární funkce providerů jsou v testu ostré potud, že KAŽDÁ z nich hned
   * sáhne na `fetch`. Kdyby je `buildModel` zavolal s prázdným klíčem, bylo by
   * to na počítadle vidět. Přesně tohle dělá skutečné SDK: při chybějícím
   * klíči nespadne, ale tiše sáhne po proměnné prostředí a odešle požadavek.
   */
  const eagerFactories = (): ProviderFactories => {
    const eager = (args: { fetch: typeof fetch }) => (modelId: string) => {
      void args.fetch('https://api.example.com/v1/messages', { method: 'POST' });
      return { modelId };
    };
    return {
      createAnthropic: eager,
      createOpenAI: eager,
      createGoogleGenerativeAI: eager,
      createOpenRouter: eager,
      createOpenAICompatible: eager,
    };
  };

  it('prázdný klíč: buildModel se ani nedostane k tovární funkci, takže fetch je nula', () => {
    for (const empty of ['', '   ', undefined, null]) {
      expect(() =>
        buildModel(
          { provider: 'anthropic', apiKey: empty as never, baseUrl: null },
          'claude-opus-5',
          { fetchImpl: spyFetch, factories: eagerFactories() },
        ),
      ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
    }
    expect(outboundCalls, `odešlo ${outboundCalls.length} požadavků: ${outboundCalls.join(', ')}`)
      .toHaveLength(0);
  });

  it('kontrolní vzorek: s platným klíčem požadavek naopak odejde, takže test měří', () => {
    buildModel({ provider: 'anthropic', apiKey: toApiKey('sk-ant-x'), baseUrl: null }, 'm', {
      fetchImpl: spyFetch,
      factories: eagerFactories(),
    });
    // Bez tohohle řádku by test prošel i s rozbitou pojistkou: nula odchozích
    // volání by mohla znamenat „chrání to" i „nikdy se nic neposílá".
    expect(outboundCalls).toHaveLength(1);
  });

  it('projekt bez credentialu: celá příprava konverzace nesáhne na síť', async () => {
    const deps: PrepareDeps = {
      loadCredential: vi.fn(async () => null),
      decryptApiKey: vi.fn(() => {
        throw new Error('dešifrování se nemělo vůbec zavolat');
      }),
      buildModel: (credential, modelId) =>
        buildModel(credential, modelId, {
          fetchImpl: spyFetch,
          factories: eagerFactories(),
        }),
      countRequestsInLastHour: vi.fn(async () => 0),
    };

    const result = await prepareConversation(
      { workspaceId: 'w1', templateId: 't1', credentialId: null, model: null, ratePerHour: 60 },
      deps,
    );

    expect(result).toMatchObject({ ok: false, code: 'ai_credential_missing' });
    expect(outboundCalls, 'bez klíče projektu odešel požadavek na cizí endpoint').toHaveLength(0);
  });

  it('měřený fetch sám o sobě nic neposílá, dokud ho někdo nezavolá', async () => {
    createMeteredFetch({ timeoutMs: 1000, fetchImpl: spyFetch });
    expect(outboundCalls).toHaveLength(0);
  });

  /**
   * Klíč z prostředí se NEPOUŽIJE. Kdyby `buildModel` uměl spadnout zpátky na
   * proměnnou prostředí, prošel by tenhle případ místo výjimky a na počítadle
   * by přibyl požadavek.
   */
  it('klíč v prostředí projekt bez vlastního klíče nezachrání', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-z-prostredi';
    try {
      expect(() =>
        buildModel({ provider: 'anthropic', apiKey: '' as never, baseUrl: null }, 'm', {
          fetchImpl: spyFetch,
          factories: eagerFactories(),
        }),
      ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
      expect(outboundCalls).toHaveLength(0);
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });
});
