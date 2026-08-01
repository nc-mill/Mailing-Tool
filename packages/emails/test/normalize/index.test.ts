import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { normalizeDocument } from '../../src/normalize/index';

const docOf = (children: unknown[], language = 'cs'): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language },
  theme: { ...DEFAULT_THEME, colors: { 'brand.primary': '#ff0000' } },
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children,
    } as unknown as SectionBlock,
  ],
});

describe('normalizeDocument', () => {
  it('does not mutate its input', () => {
    const input = docOf([]);
    const copy = structuredClone(input);
    normalizeDocument(input, { language: 'cs' });
    expect(input).toEqual(copy);
  });

  it('resolves the theme so the emitter never sees a partial color map', () => {
    const result = normalizeDocument(docOf([]), { language: 'cs' });
    expect(result.theme.light.roles['brand.primary']).toBe('#ff0000');
    expect(Object.keys(result.theme.light.roles)).toHaveLength(10);
  });

  it('skips an unknown block and warns', () => {
    const result = normalizeDocument(
      docOf([{ id: 'b_000000000002', type: 'chart', series: [1, 2] }]),
      {
        language: 'cs',
      },
    );
    expect(result.skippedBlockIds.has('b_000000000002')).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('unknown_block_skipped');
  });

  it('skips the repeat block in MVP 0 and warns', () => {
    const result = normalizeDocument(
      docOf([
        { id: 'b_000000000002', type: 'repeat', props: blockDefaults('repeat'), children: [] },
      ]),
      { language: 'cs' },
    );
    expect(result.skippedBlockIds.has('b_000000000002')).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('repeat_block_not_supported');
  });

  it('drops an unknown social network and warns instead of failing', () => {
    const social = {
      id: 'b_000000000002',
      type: 'social',
      props: {
        ...blockDefaults('social'),
        items: [
          { network: 'facebook', href: 'https://fb.com/x' },
          { network: 'someneworkwedonotknow', href: 'https://x.cz' },
        ],
      },
    };
    const result = normalizeDocument(docOf([social]), { language: 'cs' });
    const block = result.doc.blocks[0]!.children[0] as typeof social;
    expect(block.props.items).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain('social_network_unknown');
  });

  it('falls back to english for an unsupported language and warns', () => {
    const result = normalizeDocument(docOf([], 'sv-FI'), { language: 'sv-FI' });
    expect(result.language).toBe('en');
    expect(result.doc.meta.language).toBe('sv-FI');
    const warning = result.warnings.find((w) => w.code === 'language_not_supported');
    expect(warning?.params?.['language']).toBe('sv-FI');
  });

  it('keeps a supported region tag on the base language', () => {
    expect(normalizeDocument(docOf([], 'cs-CZ'), { language: 'cs-CZ' }).language).toBe('cs');
  });

  it('assigns filter slots', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          { t: 'p', children: [{ t: 'var', expr: 'contact.first_name', fallback: 'kolego' }] },
        ],
      },
    };
    const result = normalizeDocument(docOf([text]), { language: 'cs' });
    expect(result.filterSlots).toHaveLength(1);
    expect(result.filterSlots[0]!.value).toBe('kolego');
  });

  it('fills missing block props from the defaults', () => {
    const partial = { id: 'b_000000000002', type: 'spacer', props: { height: 40 } };
    const result = normalizeDocument(docOf([partial]), { language: 'cs' });
    const block = result.doc.blocks[0]!.children[0] as {
      props: { height: number; heightMobile: null };
    };
    expect(block.props.height).toBe(40);
    expect(block.props.heightMobile).toBeNull();
  });
});
