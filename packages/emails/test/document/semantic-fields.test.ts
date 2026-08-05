import { describe, expect, it } from 'vitest';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { checkFields } from '../../src/document/semantic-fields';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { en: 'First name', cs: 'Jméno' },
      group: 'name',
      deleted: false,
    },
    {
      path: 'greeting',
      type: 'string',
      label: { en: 'Greeting' },
      group: 'salutation',
      deleted: false,
    },
    { path: 'attr.city', type: 'string', label: { en: 'City' }, group: 'custom', deleted: false },
    {
      path: 'attr.is_vip',
      type: 'boolean',
      label: { en: 'VIP' },
      group: 'custom',
      deleted: false,
    },
  ],
};

const ASSET = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

const section = (children: unknown[]): SectionBlock =>
  ({
    id: 'b_000000000001',
    type: 'section',
    props: blockDefaults('section'),
    children,
  }) as SectionBlock;

const docOf = (blocks: SectionBlock[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks,
});

const run = (doc: Document, kind: 'campaign' | 'transactional' | 'system' = 'campaign') =>
  checkFields(doc, {
    templateKind: kind,
    fields: catalog,
    assetIds: new Set([ASSET]),
    estimatedHtmlBytes: 1000,
  });

describe('field and liquid semantics', () => {
  it('S4 requires an unsubscribe link in campaigns and only warns in transactional', () => {
    expect(run(docOf([section([])])).map((i) => i.code)).toContain('content_missing_unsubscribe');
    expect(
      run(docOf([section([])]), 'transactional').find(
        (i) => i.code === 'content_missing_unsubscribe',
      )?.severity,
    ).toBe('warning');
  });

  it('S6 rejects an image pointing at an unknown asset', () => {
    const image = {
      id: 'b_000000000002',
      type: 'image',
      props: {
        ...blockDefaults('image'),
        assetId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6099',
        alt: 'x',
      },
    };
    expect(run(docOf([section([image])])).map((i) => i.code)).toContain('content_asset_not_found');
  });

  it('S7 warns about an image without alt unless it is decorative', () => {
    const bare = {
      id: 'b_000000000002',
      type: 'image',
      props: { ...blockDefaults('image'), assetId: ASSET },
    };
    expect(
      run(docOf([section([bare])])).find((i) => i.code === 'content_image_missing_alt')?.severity,
    ).toBe('warning');
    const decorative = { ...bare, props: { ...bare.props, decorative: true } };
    expect(run(docOf([section([decorative])])).map((i) => i.code)).not.toContain(
      'content_image_missing_alt',
    );
  });

  it('S8 warns about text below WCAG AA in either scheme', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: { ...blockDefaults('text'), color: '#eeeeee' as const },
    };
    expect(run(docOf([section([text])])).map((i) => i.code)).toContain('content_low_contrast');
  });

  it('S9 warns above 80 kB and errors above 102 kB', () => {
    const doc = docOf([section([])]);
    const warn = checkFields(doc, {
      templateKind: 'campaign',
      fields: catalog,
      assetIds: new Set(),
      estimatedHtmlBytes: 90_000,
    });
    expect(warn.find((i) => i.code === 'content_html_too_large')?.severity).toBe('warning');
    const error = checkFields(doc, {
      templateKind: 'campaign',
      fields: catalog,
      assetIds: new Set(),
      estimatedHtmlBytes: 110_000,
    });
    expect(error.find((i) => i.code === 'content_html_too_large')?.severity).toBe('error');
  });

  it('S11 forwards liquid issues from the contract validator with a pointer', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          { t: 'p', children: [{ t: 'var', expr: 'contact.first_name | default: "kolego"' }] },
        ],
      },
    };
    const literal = run(docOf([section([text])])).find(
      (i) => i.code === 'liquid_string_literal_not_allowed',
    );
    expect(literal).toBeDefined();
    expect(literal!.pointer).toContain('/blocks/0/children/0/props/content/0/children/0');
  });

  it('S11 rejects a comparison operator, forbidden in MVP 0 by decision R7', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: { ...blockDefaults('text'), content: [] },
    };
    const html = {
      id: 'b_000000000003',
      type: 'html',
      props: { ...blockDefaults('html'), code: '{% if contact.attr.city > 5 %}x{% endif %}' },
    };
    expect(run(docOf([section([text, html])])).map((i) => i.code)).toContain(
      'liquid_comparison_operator_not_supported',
    );
  });

  it('S12 rejects a merge tag pointing at a field that does not exist', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'var', expr: 'contact.neexistuje' }] }],
      },
    };
    expect(run(docOf([section([text])])).map((i) => i.code)).toContain('liquid_unknown_field');
  });

  it('S13 rejects an unknown condition field and an operator that does not fit the type', () => {
    const bad = {
      id: 'b_000000000002',
      type: 'text',
      visibleWhen: { field: 'contact.attr.nope', op: 'present' },
      props: blockDefaults('text'),
    };
    expect(run(docOf([section([bad])])).map((i) => i.code)).toContain(
      'content_condition_field_unknown',
    );
    const wrongOp = {
      id: 'b_000000000003',
      type: 'text',
      visibleWhen: { field: 'contact.attr.city', op: 'true' },
      props: blockDefaults('text'),
    };
    expect(run(docOf([section([wrongOp])])).map((i) => i.code)).toContain(
      'content_condition_operator_invalid',
    );
    const ok = {
      id: 'b_000000000004',
      type: 'text',
      visibleWhen: { field: 'contact.attr.is_vip', op: 'true' },
      props: blockDefaults('text'),
    };
    expect(run(docOf([section([ok])])).map((i) => i.code)).not.toContain(
      'content_condition_operator_invalid',
    );
  });

  it('rejects the internal roots in an authored template', () => {
    for (const expr of ['_present.contact__city', '_context.timezone']) {
      const text = {
        id: 'b_000000000002',
        type: 'text',
        props: { ...blockDefaults('text'), content: [{ t: 'p', children: [{ t: 'var', expr }] }] },
      };
      expect(
        run(docOf([section([text])])).map((i) => i.code),
        expr,
      ).toContain('liquid_unknown_root');
    }
  });
  // Kořen `data` nese hodnoty předané při volání transakčního API. Kampani ho
  // nikdo nedodá, takže tam musí zůstat neznámý: render má strictVariables
  // vypnuté a chybějící hodnota by se tiše proměnila v prázdný řetězec.
  it('allows the data root only in a transactional template', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'var', expr: 'data.reset_url' }] }],
      },
    };
    expect(run(docOf([section([text])]), 'transactional').map((i) => i.code)).not.toContain(
      'liquid_unknown_root',
    );
    expect(run(docOf([section([text])]), 'campaign').map((i) => i.code)).toContain(
      'liquid_unknown_root',
    );
    expect(run(docOf([section([text])]), 'system').map((i) => i.code)).toContain(
      'liquid_unknown_root',
    );
  });
});
