import { describe, expect, it } from 'vitest';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { compileDocument } from '../../src/compile/compile';
import type { CompileContext } from '../../src/compile/types';

/**
 * Odkaz „Nastavit předvolby" v patičce se musí řídit nastavením PROJEKTU, ne jen
 * šablony. Zadavatel to řekl přímo: „někdy to prostě nechci nabízet, jen možnost
 * odhlásit se, pak se to nesmí objevit ani v patičce mailu."
 *
 * Odhlašovací odkaz se takhle podmínit nesmí, je to zákonná povinnost.
 */

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  workspaceId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000',
  campaignId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  templateKind: 'campaign',
  fields: catalog,
  language: 'cs',
  assetBaseUrl: 'https://assets.test',
  assets: {},
  purpose: 'send',
  trackOpens: true,
  trackClicks: true,
  currentYear: 2026,
  rawNonce: 'ab12cd34ef',
  ...over,
});

const doc = (): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: 'Preheader', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children: [{ id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') }],
    } as unknown as SectionBlock,
  ],
});

describe('centrum předvoleb a patička', () => {
  it('vynechaná volba znamená ZAPNUTO, takže se zlaté vzorky nemění', async () => {
    const result = await compileDocument(doc(), ctx());
    if (!result.ok) throw new Error('kompilace selhala');
    expect(result.html).toContain('{{ preferences_url }}');
    expect(result.text).toContain('{{ preferences_url }}');
    expect(result.meta.renderSchema.systemTags).toContain('preferences_url');
  });

  it('vypnuté centrum vyřadí odkaz z HTML, z textu I ze schématu', async () => {
    const result = await compileDocument(doc(), ctx({ preferenceCenterEnabled: false }));
    if (!result.ok) throw new Error('kompilace selhala');
    expect(result.html).not.toContain('preferences_url');
    expect(result.text).not.toContain('preferences_url');
    // Kdyby značka ve schématu zůstala, odesílač by pro každou zprávu skládal token
    // pro adresu, která ve zprávě není.
    expect(result.meta.renderSchema.systemTags).not.toContain('preferences_url');
  });

  it('odhlašovací odkaz zůstává i s vypnutým centrem předvoleb', async () => {
    const result = await compileDocument(doc(), ctx({ preferenceCenterEnabled: false }));
    if (!result.ok) throw new Error('kompilace selhala');
    expect(result.html).toContain('{{ unsubscribe_url }}');
    expect(result.text).toContain('{{ unsubscribe_url }}');
    expect(result.meta.hasUnsubscribeLink).toBe(true);
  });

  it('vypnutím nezmizí oddělovač ani zbytek patičky', async () => {
    const result = await compileDocument(doc(), ctx({ preferenceCenterEnabled: false }));
    if (!result.ok) throw new Error('kompilace selhala');
    // Dva zbylé odkazy mají mít mezi sebou právě jeden oddělovač, ne dva za sebou.
    expect(result.html).not.toContain('| |');
    expect(result.html).toContain('{{ webview_url }}');
  });
});
