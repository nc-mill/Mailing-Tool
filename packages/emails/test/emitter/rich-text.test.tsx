import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../src/document/defaults';
import { resolveTheme } from '../../src/theme/resolve';
import { RawSlotSink } from '../../src/normalize/slots';
import { EmitterProvider } from '../../src/emitter/ctx';
import { RichTextView, varOutput } from '../../src/emitter/rich-text';
import type { RichText } from '../../src/document/types';

const state = () => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink('ab12cd34ef'),
  assets: {},
  assetBaseUrl: 'https://assets.test',
  language: 'cs',
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string, trackable: boolean) =>
    trackable ? 'https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001' : href,
  t: (key: string) => key,
});

const renderRich = (rich: RichText) =>
  render(
    <EmitterProvider value={state()}>
      <div>
        <RichTextView rich={rich} color="#111827" linkColor="#1d4ed8" />
      </div>
    </EmitterProvider>,
  );

describe('varOutput', () => {
  it('wraps a plain expression in braces without touching it', () => {
    expect(varOutput({ t: 'var', expr: 'contact.first_name' })).toBe('{{ contact.first_name }}');
  });

  it('inserts the default argument marker right after the filter name', () => {
    expect(
      varOutput({
        t: 'var',
        expr: 'contact.first_name | default',
        fallback: 'kolego',
        slots: { default: 7 },
      }),
    ).toBe('{{ contact.first_name | default:ML_ARG_0007 }}');
  });

  it('keeps the author spacing of the rest of the expression', () => {
    expect(
      varOutput({ t: 'var', expr: 'contact.x|default', fallback: 'y', slots: { default: 1 } }),
    ).toBe('{{ contact.x|default:ML_ARG_0001 }}');
  });

  it('handles both filters on one node', () => {
    expect(
      varOutput({
        t: 'var',
        expr: 'contact.created_at | date | default',
        fallback: 'brzy',
        dateFormat: '%d.%m.%Y',
        slots: { default: 1, date: 2 },
      }),
    ).toBe('{{ contact.created_at | date:ML_ARG_0002 | default:ML_ARG_0001 }}');
  });

  it('emits no marker when the node carries no argument', () => {
    expect(varOutput({ t: 'var', expr: 'contact.email | upcase' })).toBe(
      '{{ contact.email | upcase }}',
    );
  });
});

describe('RichTextView', () => {
  it('renders a paragraph with the block colour', async () => {
    const html = await renderRich([{ t: 'p', children: [{ t: 's', v: 'Ahoj' }] }]);
    expect(html).toContain('Ahoj');
    expect(html).toContain('color:#111827');
  });

  it('applies marks in a fixed order so snapshots stay stable', async () => {
    const html = await renderRich([
      { t: 'p', children: [{ t: 's', v: 'x', b: true, i: true, u: true, strike: true }] },
    ]);
    expect(html).toContain('<strong><em><u><s>x</s></u></em></strong>');
  });

  it('renders lists with li items', async () => {
    const html = await renderRich([
      { t: 'ul', items: [[{ t: 's', v: 'a' }], [{ t: 's', v: 'b' }]] },
    ]);
    expect(html).toContain('<li');
    expect(html).toContain('a');
    expect(html).toContain('b');
  });

  it('routes link hrefs through the tracking marker and paints them with linkColor', async () => {
    const html = await renderRich([
      {
        t: 'p',
        children: [{ t: 'a', href: 'https://shop.cz/akce', children: [{ t: 's', v: 'Akce' }] }],
      },
    ]);
    expect(html).toContain(
      'href="https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001"',
    );
    expect(html).toContain('color:#1d4ed8');
    expect(html).toContain('class="ml-link"');
  });

  it('leaves a liquid expression byte identical after react rendering', async () => {
    const html = await renderRich([
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
    ]);
    expect(html).toContain('{{ contact.first_name | default:ML_ARG_0001 }}');
    expect(html).not.toContain('&quot;');
    expect(html).not.toContain('&#39;');
  });

  it('escapes user text but not the liquid construct around it', async () => {
    const html = await renderRich([
      {
        t: 'p',
        children: [
          { t: 's', v: '<b>&x</b>' },
          { t: 'var', expr: 'contact.email' },
        ],
      },
    ]);
    expect(html).toContain('&lt;b&gt;&amp;x&lt;/b&gt;');
    expect(html).toContain('{{ contact.email }}');
  });
});
