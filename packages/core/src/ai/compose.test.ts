import { describe, expect, it, vi } from 'vitest';
import {
  composeTemplateDraft,
  MAX_SCHEMA_DESCRIPTION_CHARS,
  SCHEMA_DESCRIPTION_SHORT,
  SHAPE_GUIDE,
  type ComposeDeps,
} from './compose';

const validOutput = {
  meta: { name: 'Letní výprodej', previewText: 'Slevy až 20 %' },
  sections: [{ kind: 'hero' as const, headline: 'Letní výprodej kol' }],
  paletteHint: 'brand' as const,
};

const brand = {
  palette: {
    primary: '#c41e3a',
    secondary: '#1a1a1a',
    accent: '#c41e3a',
    background: '#f4f5f7',
    text: '#111827',
    source: {
      primary: 'fallback' as const,
      secondary: 'fallback' as const,
      accent: 'fallback' as const,
      background: 'fallback' as const,
      text: 'fallback' as const,
    },
  },
  typography: { headingStack: 'system', bodyStack: 'system', radius: 6 },
};

const deps = (overrides: Partial<ComposeDeps> = {}) => ({
  generateStructured: vi.fn(async () => ({
    output: validOutput as unknown,
    usage: { inputTokens: 100, outputTokens: 50 },
    finishReason: 'stop',
  })),
  isNoObjectGenerated: () => false,
  buildBaseTemplate: vi.fn(() => ({ schemaVersion: 1, meta: {}, theme: {}, blocks: [] })),
  validateDocument: vi.fn(() => ({ ok: true, errors: [] as unknown[] })),
  validateLiquid: vi.fn(() => ({ ok: true, errors: [] as unknown[] })),
  ...overrides,
});

describe('compose_template', () => {
  it('platná odpověď projde a dokument postaví generátor, ne model', async () => {
    const d = deps();
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'Pozvánka na výprodej',
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(true);
    expect(d.buildBaseTemplate).toHaveBeenCalledTimes(1);
    expect(d.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('výsledek se vždy znovu ověří naším validátorem', async () => {
    const d = deps();
    await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(d.validateDocument).toHaveBeenCalledTimes(1);
    expect(d.validateLiquid).toHaveBeenCalledTimes(1);
  });

  it('nevalidní odpověď spustí právě jeden opravný pokus s výčtem chyb', async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { text: '{"meta":{}}' }))
      .mockResolvedValueOnce({
        output: validOutput,
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
      });
    const d = deps({ generateStructured, isNoObjectGenerated: () => true });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(true);
    expect(generateStructured).toHaveBeenCalledTimes(2);
    const secondPrompt = generateStructured.mock.calls[1]![0].prompt as string;
    expect(secondPrompt).toContain('{"meta":{}}');
    expect(secondPrompt).toMatch(/previewText|sections|schémat/);
  });

  it('kritérium 67: po druhém selhání se šablona nezmění a vrátí se ai_invalid_output', async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('bad'), { text: 'nesmysl' }));
    const d = deps({ generateStructured, isNoObjectGenerated: () => true });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'ai_invalid_output' });
    expect(d.buildBaseTemplate).not.toHaveBeenCalled();
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  /*
   * SPOTŘEBA SE SČÍTÁ PŘES OBĚ KOLA. Dřív se přiřazovala (`usage = response.usage`),
   * takže opravné kolo přepsalo spotřebu prvního a v přehledu chyběla polovina
   * tokenů, které uživatel zaplatil.
   */
  it('spotřeba se sčítá přes obě kola, opravné kolo tu první nepřepíše', async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('bad'), {
          text: '{"meta":{}}',
          usage: { inputTokens: 700, outputTokens: 40 },
        }),
      )
      .mockResolvedValueOnce({
        output: validOutput,
        usage: { inputTokens: 900, outputTokens: 120 },
        finishReason: 'stop',
      });
    const d = deps({ generateStructured, isNoObjectGenerated: () => true });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage).toEqual({
      inputTokens: 1600,
      outputTokens: 160,
      // Poskytovatel bez hlášené ceny: nic se nedopočítává, zůstává „nevíme".
      reported: { cost: null, cacheReadTokens: null, cacheWriteTokens: null },
    });
  });

  it('i neúspěšné skládání vrátí spotřebu, protože obě kola stála peníze', async () => {
    const generateStructured = vi.fn().mockRejectedValue(
      Object.assign(new Error('bad'), {
        text: 'nesmysl',
        usage: { inputTokens: 500, outputTokens: 25 },
      }),
    );
    const d = deps({ generateStructured, isNoObjectGenerated: () => true });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 50,
      reported: { cost: null, cacheReadTokens: null, cacheWriteTokens: null },
    });
  });

  it('nikdy se nepoužije částečná odpověď ani se nedohadují chybějící pole', async () => {
    const generateStructured = vi.fn(async () => ({
      output: { meta: { name: 'A' }, sections: [] } as unknown,
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: 'stop',
    }));
    const d = deps({ generateStructured });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(false);
    expect(d.buildBaseTemplate).not.toHaveBeenCalled();
  });

  it('dokument, který neprojde naším validátorem, se do databáze nedostane', async () => {
    const d = deps({
      validateDocument: vi.fn(() => ({
        ok: false,
        errors: [{ path: 'blocks.0', code: 'content_missing_unsubscribe' }] as unknown[],
      })),
    });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'ai_invalid_output' });
  });

  it('Liquid v textu od modelu shodí validaci, i když strukturu má správnou', async () => {
    const d = deps({
      validateLiquid: vi.fn(() => ({
        ok: false,
        errors: [{ path: 'blocks.1', code: 'liquid_tag_not_allowed' }] as unknown[],
      })),
    });
    const result = await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
      },
      d,
    );
    expect(result.ok).toBe(false);
  });
});

/**
 * Zadání pro model. Tahle skupina existuje proto, že skládání šablony
 * NEFUNGOVALO NIKDY, a pokaždé kvůli zadání, ne kvůli modelu ani klíči.
 *
 * Přísný režim strukturovaného výstupu je u poskytovatele vypnutý (naše schéma
 * je rozlišená unie, kterou odmítá), takže tvar odpovědi drží JEN tenhle text.
 * Když se rozejde se schématem, model odpoví dobře napsaný e-mail ve špatném
 * tvaru a uživatel dostane „nepodařilo se to". Naměřeno 3. 8. 2026.
 */
describe('zadání pro model', () => {
  it('popis schématu se vejde do stropu poskytovatele', () => {
    // 1057 znaků skončilo na 400 `string_above_max_length`, celý návod proto
    // patří do systémového promptu, kde žádný strop není.
    expect(SCHEMA_DESCRIPTION_SHORT.length).toBeLessThanOrEqual(MAX_SCHEMA_DESCRIPTION_CHARS);
  });

  it('návod jmenuje všechny druhy sekcí, jinak si model tvar domyslí', () => {
    for (const kind of [
      'hero',
      'article',
      'feature',
      'bullets',
      'keyValue',
      'quote',
      'cta',
      'spacer',
    ]) {
      expect(SHAPE_GUIDE).toContain(kind);
    }
  });

  it('návod říká, že sections leží vedle meta, ne uvnitř', () => {
    // Odrážkový popis model četl tak, že sections patří do meta, a vracel
    // `sections: expected array, received undefined`.
    expect(SHAPE_GUIDE).toContain('"sections"');
    expect(SHAPE_GUIDE.toLowerCase()).toContain('nejvyšší');
  });

  const promptFrom = async (websiteUrl?: string) => {
    let seen = '';
    const capture: ComposeDeps['generateStructured'] = async (params) => {
      seen = params.prompt;
      return {
        output: validOutput as unknown,
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      };
    };
    await composeTemplateDraft(
      {
        variant: 'newsletter',
        brief: 'Sleva na kávu',
        language: 'cs',
        tone: 'friendly',
        brand,
        model: {},
        ...(websiteUrl === undefined ? {} : { websiteUrl }),
      },
      deps({ generateStructured: capture }),
    );
    return seen;
  };

  it('bez adresy zakáže druhy sekcí, které mají odkaz povinný', async () => {
    const prompt = await promptFrom();
    // `cta` i `feature` mají href povinné. Bez adresy je model použít nesmí,
    // jinak dosadí "#" nebo "/eshop" a odpověď se zahodí.
    expect(prompt).toContain('"cta"');
    expect(prompt).toContain('"feature"');
    expect(prompt).toContain('nesmíš vymyslet');
  });

  it('s adresou ji vypíše a zakáže relativní odkazy', async () => {
    const prompt = await promptFrom('https://example.com');
    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('http://');
  });
});

/**
 * Opravné kolo. Druhý pokus má smysl jen tehdy, když se z něj model dozví, CO
 * konkrétně bylo špatně. Dokud dostával větu „odpověď neodpovídala schématu",
 * opravoval naslepo a jen spotřeboval tokeny.
 */
describe('opravné kolo', () => {
  it('do druhého pokusu jdou konkrétní nálezy, ne obecná věta', async () => {
    const failure = Object.assign(new Error('no object'), { text: '{"meta":{}}' });
    const generateStructured = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        output: validOutput as unknown,
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      });

    const result = await composeTemplateDraft(
      { variant: 'newsletter', brief: 'Sleva', language: 'cs', tone: 'friendly', brand, model: {} },
      deps({
        generateStructured,
        isNoObjectGenerated: () => true,
        outputIssuesOf: () => [
          {
            path: 'sections.0.cta.href',
            code: 'custom',
            message: 'base_section_href_not_absolute_http',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    const second = (generateStructured.mock.calls[1]?.[0] as { prompt: string }).prompt;
    expect(second).toContain('sections.0.cta.href');
    expect(second).toContain('base_section_href_not_absolute_http');
    expect(second).not.toContain('Odpověď nešla naparsovat');
  });

  it('nálezy se vrací i strojově, aby šly zapsat do logu bez hodnot polí', async () => {
    const failure = Object.assign(new Error('no object'), { text: '{}' });
    const result = await composeTemplateDraft(
      { variant: 'newsletter', brief: 'Sleva', language: 'cs', tone: 'friendly', brand, model: {} },
      deps({
        generateStructured: vi.fn().mockRejectedValue(failure),
        isNoObjectGenerated: () => true,
        outputIssuesOf: () => [
          { path: 'sections', code: 'invalid_type', message: 'expected array' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issueList).toEqual([
      { path: 'sections', code: 'invalid_type', message: 'expected array' },
    ]);
  });
});
