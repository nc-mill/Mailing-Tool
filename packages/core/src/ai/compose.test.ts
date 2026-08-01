import { describe, expect, it, vi } from 'vitest';
import { composeTemplateDraft, type ComposeDeps } from './compose';

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
