import { describe, expect, it } from 'vitest';
import { validateDocumentSchema } from '../../src/document/schema';
import { checkStructure } from '../../src/document/semantic-structure';
import { buildBaseTemplate, type BaseTemplateParams } from '../../src/base/build';

const brand = {
  palette: { primary: '#2563eb', background: '#f4f5f7', text: '#111827' },
  typography: { headingStack: 'Arial', bodyStack: 'Arial', radius: 6 },
};

const params = (over: Partial<BaseTemplateParams> = {}): BaseTemplateParams => ({
  variant: 'newsletter',
  brand,
  language: 'cs',
  darkMode: true,
  sections: [
    { kind: 'hero', headline: 'Vítejte', subhead: 'Novinky za červenec' },
    { kind: 'article', heading: 'První článek', body: 'Text prvního článku.' },
  ],
  ...over,
});

describe('buildBaseTemplate', () => {
  it('produces a document that passes the json schema', () => {
    expect(validateDocumentSchema(buildBaseTemplate(params()))).toEqual({ ok: true });
  });

  it('produces a document with no structural errors', () => {
    const issues = checkStructure(buildBaseTemplate(params()), { templateKind: 'campaign' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('always ends with a footer carrying the unsubscribe link', () => {
    const doc = buildBaseTemplate(params());
    const last = doc.blocks[doc.blocks.length - 1]!;
    const footer = last.children.find((child) => child.type === 'footer');
    expect(footer).toBeDefined();
  });

  it('starts with a hidden preheader section', () => {
    const doc = buildBaseTemplate(params());
    const first = JSON.stringify(doc.blocks[0]);
    expect(first).toContain('campaign.preheader');
  });

  it('never bakes the sender address in as a constant', () => {
    const json = JSON.stringify(buildBaseTemplate(params()));
    expect(json).toContain('workspace.sender_address');
  });

  it('generates unique block ids', () => {
    const doc = buildBaseTemplate(params());
    const ids = JSON.stringify(doc).match(/"b_[0-9a-z]{12}"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('applies the brand to the theme', () => {
    const doc = buildBaseTemplate(
      params({
        brand: {
          ...brand,
          palette: { primary: '#ff0000', background: '#eeeeee', text: '#222222' },
        },
      }),
    );
    expect(doc.theme.colors['brand.primary']).toBe('#ff0000');
  });

  it('supports all four variants and gives each its own middle part', () => {
    const shapes = (['newsletter', 'announcement', 'transactional', 'reengagement'] as const).map(
      (variant) =>
        JSON.stringify(
          buildBaseTemplate(
            params({
              variant,
              sections: [
                { kind: 'hero', headline: 'H' },
                { kind: 'keyValue', rows: [{ label: 'a', value: 'b' }] },
              ],
            }),
          ),
        ),
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it('turns a bullets section into a list block', () => {
    const doc = buildBaseTemplate(
      params({ sections: [{ kind: 'bullets', heading: 'Proč', items: ['Rychle', 'Levně'] }] }),
    );
    expect(JSON.stringify(doc)).toContain('"t":"ul"');
  });

  it('turns a keyValue section into a two column table of text blocks', () => {
    const doc = buildBaseTemplate(
      params({
        variant: 'transactional',
        sections: [{ kind: 'keyValue', rows: [{ label: 'Číslo', value: '123' }] }],
      }),
    );
    expect(JSON.stringify(doc)).toContain('"type":"columns"');
  });

  it('uses czech labels for cs and english for en', () => {
    const cs = JSON.stringify(buildBaseTemplate(params({ language: 'cs' })));
    const en = JSON.stringify(buildBaseTemplate(params({ language: 'en' })));
    expect(cs).toContain('Odhlásit se z odběru');
    expect(en).toContain('Unsubscribe');
  });

  it('falls back to english labels for an unsupported language', () => {
    expect(JSON.stringify(buildBaseTemplate(params({ language: 'sv-FI' })))).toContain(
      'Unsubscribe',
    );
  });

  it('is deterministic when an id generator is injected', () => {
    let counter = 0;
    const nextId = () => `b_${String(counter++).padStart(12, '0')}`;
    const a = buildBaseTemplate(params(), {
      nextId: (() => {
        counter = 0;
        return nextId;
      })(),
    });
    counter = 0;
    const b = buildBaseTemplate(params(), { nextId });
    expect(a).toEqual(b);
  });
});
