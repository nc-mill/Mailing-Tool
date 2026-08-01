import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../../src/document/defaults';
import { resolveTheme } from '../../../src/theme/resolve';
import { RawSlotSink } from '../../../src/normalize/slots';
import { EmitterProvider } from '../../../src/emitter/ctx';
import { HeadingBlockView } from '../../../src/emitter/blocks/heading';
import { TextBlockView } from '../../../src/emitter/blocks/text';

const state = () => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink('ab12cd34ef'),
  assets: {},
  assetBaseUrl: 'https://assets.test',
  language: 'cs',
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string) => href,
  t: (key: string) => key,
});

const wrap = (node: React.ReactElement) =>
  render(<EmitterProvider value={state()}>{node}</EmitterProvider>);

describe('heading block', () => {
  it('renders the semantic level and the derived size', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'heading' as const,
      props: {
        ...blockDefaults('heading'),
        level: 1 as const,
        content: [{ t: 'p' as const, children: [{ t: 's' as const, v: 'Vítejte' }] }],
      },
    };
    const html = await wrap(<HeadingBlockView block={block} />);
    expect(html).toContain('<h1');
    expect(html).toContain('font-size:31px');
    expect(html).toContain('class="ml-h1');
    expect(html).toContain('Vítejte');
  });

  it('uses the heading font stack from the theme', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'heading' as const,
      props: { ...blockDefaults('heading'), content: [{ t: 'p' as const, children: [] }] },
    };
    expect(await wrap(<HeadingBlockView block={block} />)).toContain('Segoe UI');
  });

  it('emits an exact pixel line height with the mso rule', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'heading' as const,
      props: {
        ...blockDefaults('heading'),
        level: 2 as const,
        content: [{ t: 'p' as const, children: [] }],
      },
    };
    const html = await wrap(<HeadingBlockView block={block} />);
    expect(html).toContain('mso-line-height-rule:exactly');
    expect(html).toContain('line-height:31px');
  });
});

describe('text block', () => {
  it('wraps the block in a table with padding on the td', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'text' as const,
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p' as const, children: [{ t: 's' as const, v: 'Ahoj' }] }],
      },
    };
    const html = await wrap(<TextBlockView block={block} />);
    expect(html).toContain('<table');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('padding-right:24px');
    expect(html).toContain('class="ml-pad"');
  });

  it('wraps the block in a liquid condition when visibleWhen is set', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'text' as const,
      visibleWhen: { field: 'contact.city', op: 'present' as const },
      props: { ...blockDefaults('text'), content: [{ t: 'p' as const, children: [] }] },
    };
    const html = await wrap(<TextBlockView block={block} />);
    expect(html).toContain('{% if _present.contact__city %}');
    expect(html).toContain('{% endif %}');
  });

  it('adds the mobile hiding class only when hideOnMobile is on', async () => {
    const off = {
      id: 'b_000000000001',
      type: 'text' as const,
      props: { ...blockDefaults('text'), content: [] },
    };
    expect(await wrap(<TextBlockView block={off} />)).not.toContain('ml-hide-m');
    const on = { ...off, props: { ...off.props, hideOnMobile: true } };
    expect(await wrap(<TextBlockView block={on} />)).toContain('ml-hide-m');
  });

  it('paints an explicit background instead of leaving it transparent', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'text' as const,
      props: { ...blockDefaults('text'), backgroundColor: 'surface.subtle' as const, content: [] },
    };
    expect(await wrap(<TextBlockView block={block} />)).toContain('background-color:#e5e7eb');
  });
});
