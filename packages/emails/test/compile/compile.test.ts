import { describe, expect, it } from 'vitest';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { compileDocument } from '../../src/compile/compile';
import type { CompileContext } from '../../src/compile/types';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { en: 'First name' },
      group: 'name',
      deleted: false,
    },
    {
      path: 'created_at',
      type: 'datetime',
      label: { en: 'Created' },
      group: 'meta',
      deleted: false,
    },
  ],
};

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

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: 'Preheader', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children,
    } as unknown as SectionBlock,
  ],
});

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

describe('compileDocument', () => {
  it('returns html, text and meta for a valid document', async () => {
    const result = await compileDocument(docOf([footer]), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(result.text.endsWith('\r\n')).toBe(true);
    expect(result.meta.contractVersion).toBe(1);
    expect(result.meta.rendererVersion).toMatch(/^r\d+\.\d+\.\d+$/);
    expect(result.meta.hasUnsubscribeLink).toBe(true);
    expect(result.meta.hasOpenPixelSlot).toBe(true);
  });

  it('is byte identical for two compilations of the same input', async () => {
    const a = await compileDocument(docOf([footer]), ctx());
    const b = await compileDocument(docOf([footer]), ctx());
    if (!a.ok || !b.ok) throw new Error('expected success');
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
    expect(a.meta.links).toEqual(b.meta.links);
  });

  it('inserts the fallback value in quotes without a single entity', async () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          {
            t: 'p',
            children: [{ t: 'var', expr: 'contact.first_name | default', fallback: 'kolego' }],
          },
        ],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.html).toContain('{{ contact.first_name | default:"kolego" }}');
    // Plán tady píše `not.toContain("&quot;")` nad celým HTML, jenže systémový
    // font stack má v atributu `style` `&quot;Segoe UI&quot;` a to je v pořádku:
    // je to HTML atribut, ne Liquid. Tvrzení je proto o konstrukcích, tedy přesně
    // o tom, co hlídá i invariant I1.
    for (const construct of result.html.match(/\{\{[^}]*\}\}|\{%[^%]*%\}/g) ?? []) {
      expect(construct).not.toMatch(/&(quot|#39|lt|gt|amp);/);
    }
    expect(result.html).not.toContain('ML_ARG_');
  });

  it('gives two blocks with the same expression their own fallback value', async () => {
    const block = (id: string, fallback: string) => ({
      id,
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          { t: 'p', children: [{ t: 'var', expr: 'contact.first_name | default', fallback }] },
        ],
      },
    });
    const result = await compileDocument(
      docOf([block('b_000000000002', 'kolego'), block('b_000000000003', 'zákazníku'), footer]),
      ctx(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.html.indexOf('default:"kolego"')).toBeLessThan(
      result.html.indexOf('default:"zákazníku"'),
    );
  });

  it('rejects a date format outside the whitelist', async () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          {
            t: 'p',
            children: [{ t: 'var', expr: 'contact.created_at | date', dateFormat: '%B %Y' }],
          },
        ],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain('liquid_date_format_not_allowed');
  });

  it('rejects a fallback value containing a quote', async () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          {
            t: 'p',
            children: [{ t: 'var', expr: 'contact.first_name | default', fallback: 'a"b' }],
          },
        ],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain('liquid_default_value_invalid');
  });

  it('requires a campaign id when the purpose is send', async () => {
    const result = await compileDocument(docOf([footer]), ctx({ campaignId: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain('compile_campaign_id_required');
  });

  it('allows a preview without a campaign and warns about the link ids', async () => {
    const link = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          { t: 'p', children: [{ t: 'a', href: 'https://a.cz', children: [{ t: 's', v: 'A' }] }] },
        ],
      },
    };
    const result = await compileDocument(
      docOf([link, footer]),
      ctx({ purpose: 'preview', campaignId: undefined }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.warnings.map((w) => w.code)).toContain('link_ids_not_campaign_scoped');
  });

  it('counts markers in html and text together', async () => {
    const link = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          { t: 'p', children: [{ t: 'a', href: 'https://a.cz', children: [{ t: 's', v: 'A' }] }] },
        ],
      },
    };
    const result = await compileDocument(docOf([link, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.clickMarkerCount).toBe(2);
    expect(result.meta.links).toHaveLength(1);
  });

  it('emits no marker at all when click tracking is off and escapes the ampersand in html only', async () => {
    const link = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          {
            t: 'p',
            children: [{ t: 'a', href: 'https://a.cz/?a=1&b=2', children: [{ t: 's', v: 'A' }] }],
          },
        ],
      },
    };
    const result = await compileDocument(docOf([link, footer]), ctx({ trackClicks: false }));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.clickMarkerCount).toBe(0);
    expect(result.html).toContain('?a=1&amp;b=2');
    expect(result.text).toContain('?a=1&b=2');
  });

  it('skips a repeat block and warns', async () => {
    const repeat = {
      id: 'b_000000000002',
      type: 'repeat',
      props: { ...blockDefaults('repeat'), path: 'contact.attr.items' },
      children: [],
    };
    const result = await compileDocument(docOf([repeat, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.warnings.map((w) => w.code)).toContain('repeat_block_not_supported');
  });

  it('reports byte sizes and asset ids in the meta', async () => {
    const result = await compileDocument(docOf([footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.htmlBytes).toBe(Buffer.byteLength(result.html, 'utf8'));
    expect(result.meta.textBytes).toBe(Buffer.byteLength(result.text, 'utf8'));
    expect(result.meta.assetIds).toEqual([]);
  });

  it('sets hasOpenPixelSlot false for a system template', async () => {
    const result = await compileDocument(
      docOf([footer]),
      ctx({ templateKind: 'system', trackOpens: false }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.hasOpenPixelSlot).toBe(false);
  });
});
