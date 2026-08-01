import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { normalizeDocument } from '../../src/normalize/index';
import { renderDocumentText } from '../../src/text/emit';

const MARKER = 'https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001';

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children,
    } as unknown as SectionBlock,
  ],
});

const run = (children: unknown[]) =>
  renderDocumentText({
    normalized: normalizeDocument(docOf(children), { language: 'cs' }),
    linkHref: (href: string, trackable: boolean) => (trackable ? MARKER : href),
  });

describe('plain text emitter', () => {
  it('underlines a level one heading with equals signs', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'heading',
        props: {
          ...blockDefaults('heading'),
          level: 1,
          content: [{ t: 'p', children: [{ t: 's', v: 'Vítejte' }] }],
        },
      },
    ]);
    expect(text).toContain('Vítejte\r\n=======\r\n');
  });

  it('underlines a level two heading with dashes', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'heading',
        props: {
          ...blockDefaults('heading'),
          level: 2,
          content: [{ t: 'p', children: [{ t: 's', v: 'Novinky' }] }],
        },
      },
    ]);
    expect(text).toContain('Novinky\r\n-------\r\n');
  });

  it('never uppercases a heading, at any level', () => {
    for (const level of [1, 2, 3] as const) {
      const text = run([
        {
          id: 'b_000000000002',
          type: 'heading',
          props: {
            ...blockDefaults('heading'),
            level,
            content: [
              {
                t: 'p',
                children: [
                  { t: 's', v: 'Vítejte, ' },
                  { t: 'var', expr: 'contact.first_name' },
                ],
              },
            ],
          },
        },
      ]);
      expect(text, `level ${level}`).toContain('{{ contact.first_name }}');
      expect(text, `level ${level}`).not.toContain('CONTACT.FIRST_NAME');
      expect(text, `level ${level}`).toContain('Vítejte, ');
    }
  });

  it('keeps every merge tag in the document byte identical in the text output', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'text',
        props: {
          ...blockDefaults('text'),
          content: [
            {
              t: 'p',
              children: [
                { t: 'var', expr: 'contact.greeting' },
                { t: 's', v: ' a ' },
                { t: 'var', expr: 'contact.first_name | upcase' },
              ],
            },
          ],
        },
      },
    ]);
    expect(text).toContain('{{ contact.greeting }}');
    expect(text).toContain('{{ contact.first_name | upcase }}');
  });

  it('puts a link marker on its own unwrapped line after the sentence', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'text',
        props: {
          ...blockDefaults('text'),
          content: [
            {
              t: 'p',
              children: [
                { t: 's', v: 'Podívejte se na ' },
                { t: 'a', href: 'https://shop.cz/akce', children: [{ t: 's', v: 'Zjistit více' }] },
              ],
            },
          ],
        },
      },
    ]);
    const lines = text.split('\r\n');
    expect(lines).toContain(MARKER);
    expect(lines.some((line) => line.includes('Zjistit více') && !line.includes(MARKER))).toBe(
      true,
    );
  });

  it('formats a button as an arrow prefixed label with the marker below', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'button',
        props: {
          ...blockDefaults('button'),
          href: 'https://shop.cz/akce',
          label: [{ t: 'p', children: [{ t: 's', v: 'Zjistit více' }] }],
        },
      },
    ]);
    expect(text).toContain(`>> Zjistit více:\r\n${MARKER}`);
  });

  it('renders an image alt in brackets and skips decorative images', () => {
    expect(
      run([
        {
          id: 'b_000000000002',
          type: 'image',
          props: { ...blockDefaults('image'), assetId: 'x', alt: 'Popis obrázku' },
        },
      ]),
    ).toContain('[Popis obrázku]');
    expect(
      run([
        {
          id: 'b_000000000002',
          type: 'image',
          props: { ...blockDefaults('image'), assetId: 'x', alt: 'Popis', decorative: true },
        },
      ]),
    ).not.toContain('[Popis]');
  });

  it('drops bold and italic marks', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'text',
        props: {
          ...blockDefaults('text'),
          content: [{ t: 'p', children: [{ t: 's', v: 'tučně', b: true }] }],
        },
      },
    ]);
    expect(text).toContain('tučně');
    expect(text).not.toContain('*tučně*');
  });

  it('stacks columns under each other', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'columns',
        props: blockDefaults('columns'),
        children: [0, 1].map((i) => ({
          id: `b_00000000000${i + 3}`,
          type: 'column',
          props: blockDefaults('column'),
          children: [
            {
              id: `b_00000000001${i}`,
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [{ t: 'p', children: [{ t: 's', v: `sloupec${i}` }] }],
              },
            },
          ],
        })),
      },
    ]);
    expect(text.indexOf('sloupec0')).toBeLessThan(text.indexOf('sloupec1'));
  });

  it('always contains the unsubscribe link, even when html has it only in the footer', () => {
    const text = run([{ id: 'b_000000000002', type: 'footer', props: blockDefaults('footer') }]);
    expect(text).toContain('{{ workspace.sender_address }}');
    expect(text).toContain('Odhlásit se z odběru: {{ unsubscribe_url }}');
    expect(text).toContain('Zobrazit v prohlížeči: {{ webview_url }}');
  });

  it('wraps a conditional block in the same liquid condition as html', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'text',
        visibleWhen: { field: 'contact.city', op: 'present' },
        props: {
          ...blockDefaults('text'),
          content: [{ t: 'p', children: [{ t: 's', v: 'Jsme i u vás' }] }],
        },
      },
    ]);
    expect(text).toContain('{% if _present.contact__city %}');
    expect(text).toContain('{% endif %}');
  });

  it('never has three blank lines in a row and ends with exactly one newline', () => {
    const text = run([
      { id: 'b_000000000002', type: 'spacer', props: blockDefaults('spacer') },
      { id: 'b_000000000003', type: 'spacer', props: blockDefaults('spacer') },
      { id: 'b_000000000004', type: 'spacer', props: blockDefaults('spacer') },
    ]);
    expect(text).not.toContain('\r\n\r\n\r\n\r\n');
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.endsWith('\r\n\r\n')).toBe(false);
  });

  it('converts the html block through html-to-text, the only place we convert from html', () => {
    const text = run([
      {
        id: 'b_000000000002',
        type: 'html',
        props: { ...blockDefaults('html'), code: '<p>Ahoj <b>světe</b></p>' },
      },
    ]);
    expect(text).toContain('Ahoj světe');
  });
});
