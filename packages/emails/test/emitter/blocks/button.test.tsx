import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../../src/document/defaults';
import { resolveTheme } from '../../../src/theme/resolve';
import { RawSlotSink } from '../../../src/normalize/slots';
import { EmitterProvider } from '../../../src/emitter/ctx';
import { applyRawSlots } from '../../../src/compile/apply-slots';
import { ButtonBlockView } from '../../../src/emitter/blocks/button';
import { inlineToHtmlString } from '../../../src/emitter/inline-html';
import type { ButtonBlock } from '../../../src/document/types';

const MARKER = 'https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001';

async function renderButton(props: Record<string, unknown>) {
  const sink = new RawSlotSink('ab12cd34ef');
  const state = {
    theme: resolveTheme(DEFAULT_THEME),
    raw: sink,
    assets: {},
    assetBaseUrl: 'https://assets.test',
    language: 'cs',
    skippedBlockIds: new Set<string>(),
    trackClicks: true,
    linkHref: (href: string, trackable: boolean) => (trackable ? MARKER : href),
    t: (key: string) => key,
  };
  const block = {
    id: 'b_000000000001',
    type: 'button' as const,
    props: { ...blockDefaults('button'), href: 'https://shop.cz/akce', ...props },
  } as ButtonBlock;
  const html = await render(
    <EmitterProvider value={state}>
      <ButtonBlockView block={block} width={552} />
    </EmitterProvider>,
  );
  return applyRawSlots(html, sink);
}

describe('inlineToHtmlString', () => {
  it('escapes user text and leaves the liquid construct alone', () => {
    expect(
      inlineToHtmlString([
        { t: 's', v: 'A & <b>' },
        {
          t: 'var',
          expr: 'contact.first_name | default',
          fallback: 'kolego',
          slots: { default: 3 },
        },
      ]),
    ).toBe('A &amp; &lt;b&gt;{{ contact.first_name | default:ML_ARG_0003 }}');
  });

  it('keeps marks and line breaks', () => {
    expect(inlineToHtmlString([{ t: 's', v: 'x', b: true }, { t: 'br' }])).toBe(
      '<strong>x</strong><br />',
    );
  });
});

describe('button block', () => {
  it('emits the vml variant inside a conditional comment and the table variant outside', async () => {
    const html = await renderButton({});
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('<!--[if !mso]><!-->');
    expect(html).toContain('<!--<![endif]-->');
  });

  it('uses the same tracking marker in both variants', async () => {
    const html = await renderButton({});
    const occurrences = html.split(MARKER).length - 1;
    expect(occurrences).toBe(2);
    // Odchylka od plánu: `<v:roundrect` nese před `href` ještě dva jmenné prostory,
    // bez kterých Outlook prvek nevykreslí. Tvrzení proto sedí na atribut, který
    // hned předchází, ne na začátek značky.
    expect(html).toContain(`xmlns:w="urn:schemas-microsoft-com:office:word" href="${MARKER}"`);
  });

  it('uses the same filter slot in both variants', async () => {
    const html = await renderButton({
      label: [
        {
          t: 'p',
          children: [
            {
              t: 'var',
              expr: 'contact.first_name | default',
              fallback: 'kolego',
              slots: { default: 1 },
            },
          ],
        },
      ],
    });
    const occurrences = html.split('ML_ARG_0001').length - 1;
    expect(occurrences).toBe(2);
  });

  it('paints the background explicitly in both variants', async () => {
    const html = await renderButton({ backgroundColor: '#ff0000' as const });
    expect(html).toContain('fillcolor="#ff0000"');
    expect(html).toContain('background-color:#ff0000');
  });

  it('renders an outline button without a fill', async () => {
    const html = await renderButton({
      style: 'outline' as const,
      borderWidth: 2 as const,
      borderColor: '#ff0000' as const,
    });
    expect(html).toContain('strokeweight="2px"');
    expect(html).toContain('border:2px solid #ff0000');
  });

  it('stretches to the column width and adds the mobile class when fullWidth is on', async () => {
    const html = await renderButton({ fullWidth: true });
    expect(html).toContain('ml-btn');
    expect(html).toContain('width:552px');
  });
});
