import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { checkStructure } from '../../src/document/semantic-structure';

const section = (id: string, children: unknown[] = []): SectionBlock =>
  ({ id, type: 'section', props: blockDefaults('section'), children }) as SectionBlock;

const docOf = (blocks: SectionBlock[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks,
});

const codes = (doc: Document, kind: 'campaign' | 'transactional' | 'system' = 'campaign') =>
  checkStructure(doc, { templateKind: kind }).map((i) => i.code);

describe('structural semantics', () => {
  it('S1 reports duplicate block ids and points at the second occurrence', () => {
    const doc = docOf([section('b_000000000001'), section('b_000000000001')]);
    const issues = checkStructure(doc, { templateKind: 'campaign' });
    const duplicate = issues.find((i) => i.code === 'content_duplicate_block_id');
    expect(duplicate).toBeDefined();
    expect(duplicate!.pointer).toBe('/blocks/1');
  });

  it('S2 rejects columns nested inside a column', () => {
    const inner = {
      id: 'b_000000000003',
      type: 'columns',
      props: blockDefaults('columns'),
      children: [
        { id: 'b_000000000004', type: 'column', props: blockDefaults('column'), children: [] },
        { id: 'b_000000000005', type: 'column', props: blockDefaults('column'), children: [] },
      ],
    };
    const outer = {
      id: 'b_000000000002',
      type: 'columns',
      props: blockDefaults('columns'),
      children: [
        { id: 'b_000000000006', type: 'column', props: blockDefaults('column'), children: [inner] },
        { id: 'b_000000000007', type: 'column', props: blockDefaults('column'), children: [] },
      ],
    };
    expect(codes(docOf([section('b_000000000001', [outer])]))).toContain('content_nested_columns');
  });

  it('S3 allows one footer and rejects two', () => {
    const footer = (id: string) => ({ id, type: 'footer', props: blockDefaults('footer') });
    expect(codes(docOf([section('b_000000000001', [footer('b_000000000002')])]))).not.toContain(
      'content_duplicate_footer',
    );
    expect(
      codes(
        docOf([section('b_000000000001', [footer('b_000000000002'), footer('b_000000000003')])]),
      ),
    ).toContain('content_duplicate_footer');
  });

  it('S5 reports padding wider than the column minus forty pixels', () => {
    const text = {
      id: 'b_000000000004',
      type: 'text',
      props: { ...blockDefaults('text'), padding: { top: 0, right: 100, bottom: 0, left: 100 } },
    };
    const columns = {
      id: 'b_000000000002',
      type: 'columns',
      props: { ...blockDefaults('columns'), layout: '1-1-1' as const },
      children: [
        { id: 'b_000000000003', type: 'column', props: blockDefaults('column'), children: [text] },
        { id: 'b_000000000005', type: 'column', props: blockDefaults('column'), children: [] },
        { id: 'b_000000000006', type: 'column', props: blockDefaults('column'), children: [] },
      ],
    };
    expect(codes(docOf([section('b_000000000001', [columns])]))).toContain(
      'content_padding_overflow',
    );
  });

  it('S10 rejects the html block in a system template', () => {
    const html = {
      id: 'b_000000000002',
      type: 'html',
      props: { ...blockDefaults('html'), code: '<b>x</b>' },
    };
    expect(codes(docOf([section('b_000000000001', [html])]), 'system')).toContain(
      'content_raw_html_forbidden',
    );
    expect(codes(docOf([section('b_000000000001', [html])]), 'campaign')).not.toContain(
      'content_raw_html_forbidden',
    );
  });

  it('S15 rejects a repeat inside a repeat', () => {
    const inner = {
      id: 'b_000000000003',
      type: 'repeat',
      props: blockDefaults('repeat'),
      children: [],
    };
    const outer = {
      id: 'b_000000000002',
      type: 'repeat',
      props: blockDefaults('repeat'),
      children: [inner],
    };
    expect(codes(docOf([section('b_000000000001', [outer])]))).toContain('content_nested_repeat');
  });

  it('S16 rejects every reserved marker in user text, case insensitive', () => {
    for (const marker of [
      'mlain.invalid',
      'ML_OPEN_PIXEL',
      'ML_ARG_0007',
      'ml_raw_ab12cd34ef_0001',
    ]) {
      const text = {
        id: 'b_000000000002',
        type: 'text',
        props: {
          ...blockDefaults('text'),
          content: [{ t: 'p', children: [{ t: 's', v: `x ${marker} y` }] }],
        },
      };
      expect(codes(docOf([section('b_000000000001', [text])])), marker).toContain(
        'content_reserved_marker',
      );
    }
  });

  it('rejects forbidden link schemes', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'a', href: 'javascript:alert(1)', children: [] }] }],
      },
    };
    expect(codes(docOf([section('b_000000000001', [text])]))).toContain(
      'content_link_scheme_forbidden',
    );
  });

  it('rejects a variable inside a trackable href but allows it when tracking is off', () => {
    const link = (trackable: boolean) => ({
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [
          {
            t: 'p',
            children: [
              { t: 'a', href: 'https://shop.cz/?utm={{ campaign.name }}', trackable, children: [] },
            ],
          },
        ],
      },
    });
    expect(codes(docOf([section('b_000000000001', [link(true)])]))).toContain(
      'liquid_in_trackable_href',
    );
    const off = checkStructure(docOf([section('b_000000000001', [link(false)])]), {
      templateKind: 'campaign',
    });
    expect(off.map((i) => i.code)).not.toContain('liquid_in_trackable_href');
    expect(off.find((i) => i.code === 'link_variable_not_tracked')?.severity).toBe('warning');
  });

  it('accepts a system url tag as the whole href without tracking it', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'a', href: '{{ unsubscribe_url }}', children: [] }] }],
      },
    };
    const issues = checkStructure(docOf([section('b_000000000001', [text])]), {
      templateKind: 'campaign',
    });
    expect(issues.map((i) => i.code)).not.toContain('liquid_in_trackable_href');
    expect(issues.map((i) => i.code)).not.toContain('link_variable_not_tracked');
  });

  it('S14 rejects a visibility condition on the block carrying the only unsubscribe link', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      visibleWhen: { field: 'contact.city', op: 'present' },
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'a', href: '{{ unsubscribe_url }}', children: [] }] }],
      },
    };
    expect(codes(docOf([section('b_000000000001', [text])]))).toContain(
      'content_condition_on_unsubscribe',
    );
  });

  it('rejects an anchor only href', () => {
    const anchor = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'a', href: '#', children: [] }] }],
      },
    };
    expect(codes(docOf([section('b_000000000001', [anchor])]))).toContain(
      'content_link_anchor_only',
    );
  });

  it('rejects a document above three hundred blocks', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      section(
        `b_a${String(i).padStart(11, '0')}`,
        Array.from({ length: 8 }, (_, j) => ({
          id: `b_b${String(i).padStart(5, '0')}${String(j).padStart(6, '0')}`,
          type: 'spacer',
          props: blockDefaults('spacer'),
        })),
      ),
    );
    expect(codes(docOf(many))).toContain('content_too_many_blocks');
  });
  // Transakční profil se kompiluje s vypnutým sledováním, takže proměnná
  // v odkazu tam není odchylka, ale normální stav. U kampaně pojistka platí dál.
  it('allows a liquid variable in a button href only in the transactional profile', () => {
    const button = {
      id: 'b_000000000002',
      type: 'button',
      props: { ...blockDefaults('button'), href: '{{ data.reset_url }}', trackable: true },
    };
    const doc = docOf([section('b_000000000001', [button])]);
    expect(codes(doc, 'campaign')).toContain('liquid_in_trackable_href');
    expect(codes(doc, 'transactional')).not.toContain('liquid_in_trackable_href');
    expect(codes(doc, 'transactional')).not.toContain('link_variable_not_tracked');
  });

  // Kampaň s vypnutým sledováním na jednom odkazu varování dostat MÁ: říká
  // „tenhle jeden se do statistiky nedostane".
  it('keeps the untracked link warning in a campaign', () => {
    const button = {
      id: 'b_000000000002',
      type: 'button',
      props: { ...blockDefaults('button'), href: '{{ contact.attr.city }}', trackable: false },
    };
    expect(codes(docOf([section('b_000000000001', [button])]), 'campaign')).toContain(
      'link_variable_not_tracked',
    );
  });
});
