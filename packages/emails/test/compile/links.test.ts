import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { collectLinks } from '../../src/compile/links';

const CAMPAIGN = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

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

const link = (id: string, href: string, label = 'Odkaz', trackable = true) => ({
  id,
  type: 'text',
  props: {
    ...blockDefaults('text'),
    content: [
      { t: 'p', children: [{ t: 'a', href, trackable, children: [{ t: 's', v: label }] }] },
    ],
  },
});

const run = (children: unknown[], over: Record<string, unknown> = {}) =>
  collectLinks(docOf(children), {
    campaignId: CAMPAIGN,
    trackClicks: true,
    skippedBlockIds: new Set(),
    ...over,
  });

describe('collectLinks', () => {
  it('numbers links from one in first occurrence order', () => {
    const result = run([
      link('b_000000000002', 'https://a.cz', 'A'),
      link('b_000000000003', 'https://b.cz', 'B'),
    ]);
    expect(result.links.map((l) => [l.position, l.url, l.label])).toEqual([
      [1, 'https://a.cz', 'A'],
      [2, 'https://b.cz', 'B'],
    ]);
  });

  it('gives the same target the same id and one row', () => {
    const result = run([
      link('b_000000000002', 'https://a.cz'),
      link('b_000000000003', 'https://a.cz'),
    ]);
    expect(result.links).toHaveLength(1);
    expect(result.hrefFor('https://a.cz', true)).toBe(result.hrefFor('https://a.cz', true));
  });

  it('derives the id from the campaign and the position', () => {
    const first = run([link('b_000000000002', 'https://a.cz')]).links[0]!;
    const again = run([link('b_000000000002', 'https://a.cz')]).links[0]!;
    expect(first.id).toBe(again.id);
    const other = run([link('b_000000000002', 'https://a.cz')], {
      campaignId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072',
    }).links[0]!;
    expect(other.id).not.toBe(first.id);
  });

  it('uses the nil uuid when there is no campaign, keeping previews deterministic', () => {
    const result = run([link('b_000000000002', 'https://a.cz')], { campaignId: undefined });
    expect(result.warnings.map((w) => w.code)).toContain('link_ids_not_campaign_scoped');
    expect(result.links[0]!.id).toBe(
      run([link('b_000000000002', 'https://a.cz')], { campaignId: undefined }).links[0]!.id,
    );
  });

  it('returns the marker as the whole href value', () => {
    const result = run([link('b_000000000002', 'https://a.cz')]);
    expect(result.hrefFor('https://a.cz', true)).toBe(
      `https://track.mlain.invalid/c/${result.links[0]!.id}`,
    );
  });

  it('never marks mailto, tel, system tags or a variable href', () => {
    const result = run([
      link('b_000000000002', 'mailto:a@b.cz'),
      link('b_000000000003', 'tel:+420123456789'),
      link('b_000000000004', '{{ unsubscribe_url }}'),
      link('b_000000000005', '{{ contact.attr.url }}', 'X', false),
    ]);
    expect(result.hrefFor('mailto:a@b.cz', true)).toBe('mailto:a@b.cz');
    expect(result.hrefFor('tel:+420123456789', true)).toBe('tel:+420123456789');
    expect(result.hrefFor('{{ unsubscribe_url }}', true)).toBe('{{ unsubscribe_url }}');
    expect(result.hrefFor('{{ contact.attr.url }}', false)).toBe('{{ contact.attr.url }}');
    expect(result.links).toHaveLength(0);
  });

  it('still records rows when click tracking is off but emits the target url', () => {
    const result = run([link('b_000000000002', 'https://a.cz')], { trackClicks: false });
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.trackable).toBe(true);
    expect(result.hrefFor('https://a.cz', true)).toBe('https://a.cz');
  });

  it('collects button and image links with a useful label', () => {
    const result = run([
      {
        id: 'b_000000000002',
        type: 'button',
        props: {
          ...blockDefaults('button'),
          href: 'https://c.cz',
          label: [{ t: 'p', children: [{ t: 's', v: 'Koupit' }] }],
        },
      },
      {
        id: 'b_000000000003',
        type: 'image',
        props: { ...blockDefaults('image'), assetId: 'x', alt: 'Banner', href: 'https://d.cz' },
      },
    ]);
    expect(result.links.map((l) => l.label)).toEqual(['Koupit', 'Banner']);
  });

  it('ignores links inside a skipped block', () => {
    const result = run([link('b_000000000002', 'https://a.cz')], {
      skippedBlockIds: new Set(['b_000000000002']),
    });
    expect(result.links).toHaveLength(0);
  });

  it('rejects more than 999 links', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      link(`b_c${String(i).padStart(11, '0')}`, `https://a.cz/${i}`),
    );
    expect(run(many).issues.map((i) => i.code)).toContain('content_too_many_links');
  });
});
