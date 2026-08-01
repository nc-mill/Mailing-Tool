import { describe, expect, it } from 'vitest';
import type { RichNode, RichText } from './document-types';
import { richTextToTiptap, tiptapToRichText } from './richtext';

type Paragraph = Extract<RichNode, { t: 'p' }>;

const sample: RichText = [
  {
    t: 'p',
    align: 'center',
    children: [
      { t: 's', v: 'Dobrý den, ' },
      { t: 'var', expr: 'contact.first_name_vocative', fallback: 'kolego' },
      { t: 's', v: ' a ', b: true, i: true },
      { t: 'a', href: 'https://shop.cz', trackable: true, children: [{ t: 's', v: 'nabídka' }] },
      { t: 'br' },
    ],
  },
  { t: 'ul', items: [[{ t: 's', v: 'první' }], [{ t: 's', v: 'druhá' }]] },
  { t: 'ol', items: [[{ t: 's', v: 'krok' }]] },
];

describe('richtext', () => {
  it('převede odstavec, zarovnání a značky', () => {
    const tiptap = richTextToTiptap(sample);
    expect(tiptap.type).toBe('doc');
    const paragraph = tiptap.content![0]!;
    expect(paragraph).toMatchObject({ type: 'paragraph', attrs: { align: 'center' } });
    expect(paragraph.content![2]).toMatchObject({
      type: 'text',
      text: ' a ',
      marks: [{ type: 'bold' }, { type: 'italic' }],
    });
  });

  it('personalizaci převede na vlastní uzel, ne na text', () => {
    const node = richTextToTiptap(sample).content![0]!.content![1];
    expect(node).toEqual({
      type: 'personalization',
      attrs: { expr: 'contact.first_name_vocative', fallback: 'kolego', dateFormat: null },
    });
  });

  it('odkaz převede na značku a zpět na uzel', () => {
    const back = tiptapToRichText(richTextToTiptap(sample));
    expect((back[0] as Paragraph).children[3]).toEqual({
      t: 'a',
      href: 'https://shop.cz',
      trackable: true,
      children: [{ t: 's', v: 'nabídka' }],
    });
  });

  it('sousední text pod jedním odkazem sloučí do jednoho uzlu', () => {
    const tiptap = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [{ type: 'link', attrs: { href: 'https://x.cz', trackable: true } }],
            },
            {
              type: 'text',
              text: 'b',
              marks: [
                { type: 'link', attrs: { href: 'https://x.cz', trackable: true } },
                { type: 'bold' },
              ],
            },
          ],
        },
      ],
    };
    const rich = tiptapToRichText(tiptap);
    expect((rich[0] as Paragraph).children).toEqual([
      {
        t: 'a',
        href: 'https://x.cz',
        trackable: true,
        children: [
          { t: 's', v: 'a' },
          { t: 's', v: 'b', b: true },
        ],
      },
    ]);
  });

  it('okružní převod zachová dokument beze změny', () => {
    expect(tiptapToRichText(richTextToTiptap(sample))).toEqual(sample);
  });

  it('prázdný text dá jeden prázdný odstavec', () => {
    expect(tiptapToRichText({ type: 'doc', content: [] })).toEqual([{ t: 'p', children: [] }]);
  });
});
