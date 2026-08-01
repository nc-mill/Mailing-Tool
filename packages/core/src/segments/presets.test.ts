import { describe, expect, it } from 'vitest';
import { SEGMENT_PRESETS, presetByKey } from './presets';
import { SegmentAstV1 } from './ast';
import { assertWithinLimits } from './limits';

const LIST_ID = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa';

describe('cleanup presets', () => {
  it('defines exactly the six documented keys', () => {
    expect(SEGMENT_PRESETS.map((p) => p.key)).toEqual([
      'never_opened',
      'never_clicked',
      'inactive_90d',
      'no_open_last_n',
      'unconfirmed_30d',
      'repeated_soft_bounces',
    ]);
  });

  it('produces a valid ast for every preset', () => {
    for (const preset of SEGMENT_PRESETS) {
      const ast = SegmentAstV1.parse(preset.definition({ listId: LIST_ID }));
      expect(() => assertWithinLimits(ast), preset.key).not.toThrow();
    }
  });

  it('produces a valid ast even without a list id', () => {
    for (const preset of SEGMENT_PRESETS) {
      const ast = SegmentAstV1.parse(preset.definition({}));
      expect(() => assertWithinLimits(ast), preset.key).not.toThrow();
    }
  });

  it('guards never_opened with a minimum number of sent messages', () => {
    const ast = presetByKey('never_opened').definition({});
    const json = JSON.stringify(ast);
    expect(json).toContain('"count_gte"');
    expect(json).toContain('"sent"');
  });

  it('guards never_clicked with at least five sent messages', () => {
    const ast = presetByKey('never_clicked').definition({});
    const cond = ast.root.children.find(
      (c) => c.type === 'condition' && c.field.kind === 'engagement' && c.field.metric === 'sent',
    );
    expect(cond).toMatchObject({ operator: 'count_gte', value: 5 });
  });

  it('uses relative operators, never a literal date', () => {
    for (const preset of SEGMENT_PRESETS) {
      const json = JSON.stringify(preset.definition({ listId: LIST_ID }));
      expect(json, preset.key).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  it('adds the list condition only when a list id is given', () => {
    const withList = presetByKey('unconfirmed_30d').definition({ listId: LIST_ID });
    const withoutList = presetByKey('unconfirmed_30d').definition({});
    expect(withList.root.children).toHaveLength(2);
    expect(withoutList.root.children).toHaveLength(1);
  });

  it('refuses an unknown key instead of returning undefined', () => {
    expect(() => presetByKey('nonsense' as never)).toThrowError(/unknown preset/);
  });
});
