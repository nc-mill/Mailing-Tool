import { describe, expectTypeOf, it } from 'vitest';
import type {
  ButtonBlock,
  ColumnsLayout,
  ContentBlock,
  DateFormat,
  Document,
  InlineNode,
  SectionBlock,
  ThemeColorRole,
  VisibilityCondition,
} from '../../src/document/types';

describe('document types', () => {
  it('accepts a minimal valid document', () => {
    const doc: Document = {
      schemaVersion: 1,
      meta: { name: 'Test', previewText: '', language: 'cs' },
      theme: {
        contentWidth: 600,
        canvasBackground: 'surface.canvas',
        contentBackground: 'surface.content',
        colors: {},
        fonts: { heading: 'system', body: 'system' },
        typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
        radius: 6,
        darkMode: { strategy: 'auto', colors: {} },
      },
      blocks: [],
    };
    expectTypeOf(doc.blocks).toEqualTypeOf<SectionBlock[]>();
  });

  it('models a var node with fallback and dateFormat as node attributes', () => {
    const node: InlineNode = {
      t: 'var',
      expr: 'contact.first_name',
      fallback: 'kolego',
    };
    expectTypeOf(node).toMatchTypeOf<InlineNode>();
    expectTypeOf<DateFormat>().toEqualTypeOf<
      '%d.%m.%Y' | '%-d.%-m.%Y' | '%Y-%m-%d' | '%d.%m.%Y %H:%M' | '%H:%M'
    >();
  });

  it('keeps visibility operators closed', () => {
    expectTypeOf<VisibilityCondition['op']>().toEqualTypeOf<
      'present' | 'blank' | 'true' | 'false'
    >();
  });

  it('has exactly ten theme color roles and six column layouts', () => {
    expectTypeOf<ThemeColorRole>().toEqualTypeOf<
      | 'brand.primary'
      | 'brand.secondary'
      | 'brand.accent'
      | 'text.default'
      | 'text.muted'
      | 'text.inverted'
      | 'surface.canvas'
      | 'surface.content'
      | 'surface.subtle'
      | 'link.default'
    >();
    expectTypeOf<ColumnsLayout>().toEqualTypeOf<
      '1-1' | '1-2' | '2-1' | '1-1-1' | '2-1-1' | '1-1-2'
    >();
  });

  it('puts button and footer in the content block union', () => {
    expectTypeOf<ButtonBlock>().toMatchTypeOf<ContentBlock>();
  });
});
