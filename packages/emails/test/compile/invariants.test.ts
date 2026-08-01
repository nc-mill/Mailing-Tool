import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../src/compile/invariants';

const link = {
  id: '2f1a9c40-0000-5000-8000-000000000001',
  position: 1,
  url: 'https://a.cz',
  trackable: true,
  label: 'A',
};
const MARKER = `https://track.mlain.invalid/c/${link.id}`;

const base = (over: Record<string, unknown> = {}) => ({
  html: `<!DOCTYPE html><html><body><a href="${MARKER}">x</a><!--ML_OPEN_PIXEL--></body></html>`,
  text: `${MARKER}\r\n`,
  links: [link],
  trackOpens: true,
  purpose: 'send' as const,
  filterSlots: [],
  usedSlots: new Set<number>(),
  unknownSlots: [] as number[],
  exemptSlots: new Set<number>(),
  rawPrefix: 'ML_RAW_ab12cd34ef_',
  ...over,
});

const codes = (over: Record<string, unknown> = {}) =>
  checkInvariants(base(over)).issues.map((i) => i.code);

describe('invariants', () => {
  it('passes for a well formed document', () => {
    expect(codes()).toEqual([]);
  });

  it('I1 rejects a corrupted liquid construct', () => {
    expect(
      codes({ html: '<html><body>{{ contact.first_name | nope }}</body></html>', text: '' }),
    ).toContain('render_liquid_corrupted');
  });

  it('I1 rejects an html entity inside a liquid construct', () => {
    expect(
      codes({ html: '<html><body>{{ x | default: &quot;y&quot; }}</body></html>', text: '' }),
    ).toContain('liquid_escaped_entity_in_construct');
  });

  it('I1 accepts a balanced conditional split across two constructs', () => {
    expect(
      codes({
        html: '<html><body>{% if _present.contact__city %}x{% endif %}<!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toEqual([]);
  });

  it('I1 rejects an unbalanced conditional', () => {
    expect(
      codes({
        html: '<html><body>{% if _present.contact__city %}x<!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_liquid_corrupted');
  });

  it('I2 requires exactly one pixel marker when opens are tracked', () => {
    expect(codes({ html: '<html><body>none</body></html>', text: '', links: [] })).toContain(
      'render_pixel_slot_invalid',
    );
    expect(
      codes({
        html: '<html><body><!--ML_OPEN_PIXEL--><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_pixel_slot_invalid');
    expect(
      codes({ html: '<html><body>x</body></html>', text: '', links: [], trackOpens: false }),
    ).not.toContain('render_pixel_slot_invalid');
  });

  it('I3 rejects a marker whose uuid is not in the link map', () => {
    expect(
      codes({
        html: '<html><body><a href="https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000009">x</a><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
      }),
    ).toContain('render_link_map_mismatch');
  });

  it('I3 rejects positions that are not a contiguous run from one', () => {
    expect(codes({ links: [{ ...link, position: 2 }] })).toContain('render_link_map_mismatch');
  });

  it('I3 counts markers in html and text together', () => {
    expect(checkInvariants(base()).clickMarkerCount).toBe(2);
  });

  it('I4 rejects editor attributes leaking into a send render', () => {
    expect(
      codes({
        html: '<html><body><div data-ml-block="b_1"></div><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_editor_attrs_leaked');
    expect(
      codes({
        html: '<html><body><div data-ml-block="b_1"></div></body></html>',
        text: '',
        links: [],
        trackOpens: false,
        purpose: 'preview',
      }),
    ).not.toContain('render_editor_attrs_leaked');
  });

  it('I5 rejects unbalanced tables outside conditional comments', () => {
    expect(
      codes({
        html: '<html><body><table><tr><td>x</td></tr><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_invalid_html');
  });

  it('I5 accepts tables opened only inside a conditional comment', () => {
    expect(
      codes({
        html: '<html><body><!--[if mso]><table><tr><td><![endif]-->x<!--[if mso]></td></tr></table><![endif]--><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).not.toContain('render_invalid_html');
  });

  it('I6 rejects forbidden content', () => {
    for (const bad of ['<script>', 'javascript:void(0)', 'onerror=x', 'onload=x']) {
      expect(
        codes({
          html: `<html><body>${bad}<!--ML_OPEN_PIXEL--></body></html>`,
          text: '',
          links: [],
        }),
        bad,
      ).toContain('render_forbidden_content');
    }
  });

  it('I7 requires src, width, height and alt on every image', () => {
    expect(
      codes({
        html: '<html><body><img src="a.png"><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_image_incomplete');
    expect(
      codes({
        html: '<html><body><img src="a.png" width="1" height="1" alt=""><!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).not.toContain('render_image_incomplete');
  });

  it('I8 is a warning, never an error', () => {
    const big = `<html><body>${'x'.repeat(110_000)}<!--ML_OPEN_PIXEL--></body></html>`;
    const result = checkInvariants(base({ html: big, text: '', links: [] }));
    const found = result.issues.find((i) => i.code === 'render_too_large');
    expect(found?.severity).toBe('warning');
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('I9 rejects an unresolved filter slot', () => {
    expect(
      codes({
        html: '<html><body>ML_ARG_0001<!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_filter_slot_unresolved');
  });

  it('I10 reports a slot that never appeared, unless its block is conditional', () => {
    const slots = [{ slot: 1, blockId: 'b_1', filter: 'default' as const, value: 'x' }];
    expect(codes({ filterSlots: slots, usedSlots: new Set() })).toContain(
      'render_filter_slot_missing',
    );
    expect(
      codes({ filterSlots: slots, usedSlots: new Set(), exemptSlots: new Set([1]) }),
    ).not.toContain('render_filter_slot_missing');
  });

  it('I11 rejects an unknown slot number and a value outside the whitelist', () => {
    expect(codes({ unknownSlots: [99] })).toContain('render_filter_slot_invalid_value');
  });

  it('I12 rejects a leftover raw slot marker', () => {
    expect(
      codes({
        html: '<html><body>ML_RAW_ab12cd34ef_0001<!--ML_OPEN_PIXEL--></body></html>',
        text: '',
        links: [],
      }),
    ).toContain('render_raw_slot_unresolved');
  });
});
