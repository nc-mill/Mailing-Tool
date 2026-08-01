import { describe, expect, it, vi } from 'vitest';
import { buildTools, type ToolContext } from './index';

const baseCtx = () => ({
  workspaceId: 'w1',
  templateId: 't1',
  language: 'cs',
  userUrls: new Set(['https://kolo-shop.cz/']),
  // Katalog polí z P07: definice, nikdy hodnoty.
  fieldCatalog: {
    fields: [{ path: 'first_name', type: 'string', label: { en: 'First name', cs: 'Jméno' } }],
  },
  startBrandExtraction: vi.fn(async () => ({
    brandProfileId: 'b1',
    palette: { primary: '#c41e3a' },
    logoAssetId: 'a1',
    warnings: [] as string[],
  })),
  composeTemplate: vi.fn(async () => ({ templateDraftId: 'd1', preview: { sections: [] } })),
  writeCopy: vi.fn(async () => ({ text: 'Krátký text' })),
  suggestSubject: vi.fn(async () => ({
    variants: [{ subject: 'A', preheader: 'B', rationale: 'C' }],
  })),
});

describe('sada nástrojů', () => {
  it('má právě pět nástrojů se stabilními názvy', () => {
    expect(Object.keys(buildTools(baseCtx())).sort()).toEqual([
      'composeTemplate',
      'extractBrand',
      'listMergeTags',
      'suggestSubject',
      'writeCopy',
    ]);
  });

  /**
   * Odchylka od doslovného znění plánu, vynucená úkolem 17: `listMergeTags`
   * se do kontextu NEINJEKTUJE jako funkce. Kdyby se injektovala, testovala by
   * se náhrada, ne skutečná implementace, a kritérium 70 by nehlídal nikdo.
   * Kontext dostane katalog polí a nástroj z něj vyrobí merge tagy sám.
   */
  it('listMergeTags vrátí názvy polí, nikdy hodnoty kontaktů', async () => {
    const ctx = baseCtx();
    const result = (await buildTools(ctx).listMergeTags.execute()) as {
      tags: Array<{ path: string; label: string; example: string }>;
    };
    expect(result.tags[0]).toMatchObject({ path: 'contact.first_name', label: 'Jméno' });
    expect(result.tags[0]!.example).toBe('ukázkový text');
  });

  it('extractBrand s adresou od uživatele proběhne', async () => {
    const ctx = baseCtx();
    const result = await buildTools(ctx).extractBrand.execute({
      url: 'https://kolo-shop.cz/o-nas',
    });
    expect(result).toMatchObject({ brandProfileId: 'b1' });
    expect(ctx.startBrandExtraction).toHaveBeenCalled();
  });

  it('extractBrand s vymyšlenou adresou se neprovede a vrátí modelu chybu', async () => {
    const ctx = baseCtx();
    const result = await buildTools(ctx).extractBrand.execute({
      url: 'http://169.254.169.254/latest/meta-data/',
    });
    expect(result).toEqual({
      error: 'url_not_provided_by_user',
      hint: 'Zeptej se uživatele, ze které adresy má nástroj stáhnout značku.',
    });
    expect(ctx.startBrandExtraction).not.toHaveBeenCalled();
  });

  it('chyba nástroje se vrací modelu jako výsledek, ne jako výjimka, aby se model zotavil', async () => {
    const ctx: ToolContext = {
      ...baseCtx(),
      composeTemplate: vi.fn(async () => {
        throw Object.assign(new Error('nope'), { code: 'ai_invalid_output' });
      }),
    };
    const result = await buildTools(ctx).composeTemplate.execute({
      kind: 'newsletter',
      brief: 'x'.repeat(20),
      language: 'cs',
      tone: 'friendly',
    });
    expect(result).toEqual({ error: 'ai_invalid_output' });
  });

  it('writeCopy pro bullets vrací položky, ne jeden řetězec', async () => {
    const ctx: ToolContext = {
      ...baseCtx(),
      writeCopy: vi.fn(async () => ({ items: ['První', 'Druhá'] })),
    };
    const result = await buildTools(ctx).writeCopy.execute({
      kind: 'bullets',
      instruction: 'Tři body',
      language: 'cs',
      tone: 'friendly',
    });
    expect(result).toEqual({ items: ['První', 'Druhá'] });
  });
});
