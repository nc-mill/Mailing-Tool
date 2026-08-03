import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../../src/document/defaults';
import { resolveTheme } from '../../../src/theme/resolve';
import { RawSlotSink } from '../../../src/normalize/slots';
import type { EmitterState } from '../../../src/emitter/ctx';
import { applyRawSlots } from '../../../src/compile/apply-slots';
import { SectionBlockView } from '../../../src/emitter/blocks/section';
import type { SectionBlock } from '../../../src/document/types';

function emitterState(sink: RawSlotSink, skippedBlockIds = new Set<string>()): EmitterState {
  return {
    theme: resolveTheme(DEFAULT_THEME),
    raw: sink,
    assets: {},
    assetBaseUrl: 'https://assets.test',
    language: 'cs',
    skippedBlockIds,
    trackClicks: true,
    linkHref: (href: string) => href,
    t: (key: string) => key,
  };
}

async function renderSection(block: SectionBlock) {
  const sink = new RawSlotSink('ab12cd34ef');
  const html = await render(<SectionBlockView block={block} emitter={emitterState(sink)} />);
  return applyRawSlots(html, sink);
}

const section = (children: unknown[], props = {}): SectionBlock =>
  ({
    id: 'b_000000000001',
    type: 'section',
    props: { ...blockDefaults('section'), ...props },
    children,
  }) as SectionBlock;

describe('section', () => {
  it('wraps content in a canvas table and a fixed width content table', async () => {
    const html = await renderSection(section([]));
    expect(html).toContain('class="ml-canvas"');
    expect(html).toContain('class="ml-content"');
    expect(html).toContain('width="600"');
    expect(html).toContain('max-width:100%');
  });

  it('drops the width constraint for a full width section', async () => {
    const html = await renderSection(section([], { fullWidth: true }));
    expect(html).not.toContain('width="600"');
  });

  it('paints both backgrounds explicitly, never transparent', async () => {
    const html = await renderSection(
      section([], { outerBackgroundColor: '#111111', backgroundColor: '#222222' }),
    );
    expect(html).toContain('background-color:#111111');
    expect(html).toContain('background-color:#222222');
  });

  it('wraps the whole section in a condition when visibleWhen is set', async () => {
    const block = section([]);
    block.visibleWhen = { field: 'contact.city', op: 'present' };
    const html = await renderSection(block);
    expect(html.indexOf('{% if _present.contact__city %}')).toBeLessThan(html.indexOf('<table'));
    expect(html).toContain('{% endif %}');
  });
});

describe('columns', () => {
  const withColumns = (layout: '1-1' | '1-1-1' = '1-1') =>
    section([
      {
        id: 'b_000000000002',
        type: 'columns',
        props: { ...blockDefaults('columns'), layout },
        children: Array.from({ length: layout === '1-1' ? 2 : 3 }, (_, i) => ({
          id: `b_00000000000${i + 3}`,
          type: 'column',
          props: blockDefaults('column'),
          children: [
            {
              id: `b_00000000001${i}`,
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [{ t: 'p', children: [{ t: 's', v: `col${i}` }] }],
              },
            },
          ],
        })),
      },
    ]);

  it('emits ghost table cells for outlook and inline block divs for everyone else', async () => {
    const html = await renderSection(withColumns());
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('class="ml-col"');
    expect(html).toContain('display:inline-block');
  });

  it('emits the content exactly once so link markers cannot double', async () => {
    const html = await renderSection(withColumns());
    expect(html.split('col0').length - 1).toBe(1);
    expect(html.split('col1').length - 1).toBe(1);
  });

  it('uses pixel widths that add up with the gap', async () => {
    const html = await renderSection(withColumns());
    // Vnitřní šířka 600 - 24 - 24 = 552, gap 16, tedy 268 na sloupec.
    expect(html).toContain('width:268px');
    expect(html).toContain('width="268"');
  });

  it('reverses the visual order when stackOrder is reverse', async () => {
    const block = withColumns();
    const columns = (block.children[0] as unknown as { props: { stackOrder: string } }).props;
    columns.stackOrder = 'reverse';
    const html = await renderSection(block);
    expect(html.indexOf('col1')).toBeLessThan(html.indexOf('col0'));
  });
});

describe('dispatch', () => {
  it('skips a block listed as skipped', async () => {
    const sink = new RawSlotSink('ab12cd34ef');
    const html = await render(
      <SectionBlockView
        emitter={emitterState(sink, new Set(['b_000000000002']))}
        block={section([
          {
            id: 'b_000000000002',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'hidden' }] }],
            },
          },
        ])}
      />,
    );
    expect(applyRawSlots(html, sink)).not.toContain('hidden');
  });
});
