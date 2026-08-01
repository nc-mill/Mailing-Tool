import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../../src/document/defaults';
import { resolveTheme } from '../../../src/theme/resolve';
import { RawSlotSink } from '../../../src/normalize/slots';
import { EmitterProvider } from '../../../src/emitter/ctx';
import { applyRawSlots } from '../../../src/compile/apply-slots';
import { DividerBlockView } from '../../../src/emitter/blocks/divider';
import { SpacerBlockView } from '../../../src/emitter/blocks/spacer';
import { HtmlBlockView } from '../../../src/emitter/blocks/html-block';
import { SocialBlockView } from '../../../src/emitter/blocks/social';
import { FooterBlockView } from '../../../src/emitter/blocks/footer';
import type {
  DividerBlock,
  FooterBlock,
  HtmlBlock,
  SocialBlock,
  SpacerBlock,
} from '../../../src/document/types';

async function renderBlock(node: React.ReactElement) {
  const sink = new RawSlotSink('ab12cd34ef');
  const html = await render(
    <EmitterProvider
      value={{
        theme: resolveTheme(DEFAULT_THEME),
        raw: sink,
        assets: {},
        assetBaseUrl: 'https://assets.test',
        language: 'cs',
        skippedBlockIds: new Set<string>(),
        trackClicks: true,
        linkHref: (href: string) => href,
        t: (key: string) => key,
      }}
    >
      {node}
    </EmitterProvider>,
  );
  return applyRawSlots(html, sink);
}

describe('divider', () => {
  it('renders a bordered cell, never an hr', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'divider' as const,
      props: { ...blockDefaults('divider'), thickness: 2 as const, style: 'dashed' as const },
    } as DividerBlock;
    const html = await renderBlock(<DividerBlockView block={block} />);
    expect(html).toContain('border-top:2px dashed');
    expect(html).not.toContain('<hr');
  });
});

describe('spacer', () => {
  it('renders an exact height with the mso rule', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'spacer' as const,
      props: { ...blockDefaults('spacer'), height: 40 },
    } as SpacerBlock;
    const html = await renderBlock(<SpacerBlockView block={block} />);
    expect(html).toContain('height:40px');
    expect(html).toContain('line-height:40px');
    expect(html).toContain('font-size:0');
    expect(html).toContain('mso-line-height-rule:exactly');
  });
});

describe('html block', () => {
  it('keeps allowed markup and liquid, drops scripts and event handlers', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'html' as const,
      props: {
        ...blockDefaults('html'),
        code: '<p onclick="x()">Ahoj {{ contact.first_name }}</p><script>alert(1)</script>',
      },
    } as HtmlBlock;
    const html = await renderBlock(<HtmlBlockView block={block} />);
    expect(html).toContain('Ahoj {{ contact.first_name }}');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('drops a style element so it cannot fight the head css', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'html' as const,
      props: { ...blockDefaults('html'), code: '<style>p{color:red}</style><p>x</p>' },
    } as HtmlBlock;
    const html = await renderBlock(<HtmlBlockView block={block} />);
    expect(html).not.toContain('<style');
    expect(html).toContain('<p>x</p>');
  });
});

describe('social', () => {
  it('renders one icon per item with a product icon url', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'social' as const,
      props: {
        ...blockDefaults('social'),
        items: [
          { network: 'facebook' as const, href: 'https://fb.com/x' },
          { network: 'bluesky' as const, href: 'https://bsky.app/x', label: 'Bluesky' },
        ],
      },
    } as SocialBlock;
    const html = await renderBlock(<SocialBlockView block={block} />);
    expect(html).toContain('/a/social/facebook-color@2x.png');
    expect(html).toContain('/a/social/bluesky-color@2x.png');
    expect(html).toContain('alt="Bluesky"');
    expect(html).toContain('width="28"');
  });
});

describe('footer', () => {
  it('renders the sender address as a merge tag, never as a constant', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'footer' as const,
      props: blockDefaults('footer'),
    } as FooterBlock;
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain('{{ workspace.sender_address }}');
  });

  it('renders all three system links as untouched liquid', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'footer' as const,
      props: blockDefaults('footer'),
    } as FooterBlock;
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain('href="{{ unsubscribe_url }}"');
    expect(html).toContain('href="{{ preferences_url }}"');
    expect(html).toContain('href="{{ webview_url }}"');
    expect(html).not.toContain('track.mlain.invalid');
  });

  it('omits a link when its switch is off', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'footer' as const,
      props: { ...blockDefaults('footer'), showPreferences: false, showWebview: false },
    } as FooterBlock;
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain('{{ unsubscribe_url }}');
    expect(html).not.toContain('{{ preferences_url }}');
  });

  it('paints the footer with the muted class so dark mode can recolour it', async () => {
    const block = {
      id: 'b_000000000001',
      type: 'footer' as const,
      props: blockDefaults('footer'),
    } as FooterBlock;
    expect(await renderBlock(<FooterBlockView block={block} />)).toContain('ml-muted');
  });
});
