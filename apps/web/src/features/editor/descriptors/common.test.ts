import { describe, expect, it } from 'vitest';
import { COMMON_DEFAULTS, contentGroups, PROP_KINDS } from './common';

describe('common descriptors', () => {
  it('zná dvanáct druhů vlastností', () => {
    expect([...PROP_KINDS].sort()).toEqual([
      'asset',
      'code',
      'color',
      'link',
      'number',
      'padding',
      'richtext',
      'select',
      'socialItems',
      'text',
      'toggle',
      'visibility',
    ]);
  });

  it('společné skupiny obsahují odsazení, pozadí, skrytí na mobilu a podmínku zobrazení', () => {
    const keys = contentGroups().flatMap((g) => g.props.map((p) => p.key));
    expect(keys).toEqual(['padding', 'backgroundColor', 'hideOnMobile', 'visibleWhen']);
  });

  it('patička nedostane podmínku zobrazení, pravidlo S14', () => {
    const keys = contentGroups({ visibility: false }).flatMap((g) => g.props.map((p) => p.key));
    expect(keys).not.toContain('visibleWhen');
  });

  it('výchozí odsazení odpovídá tabulce z části 3, 3.2', () => {
    expect(COMMON_DEFAULTS.padding).toEqual({ top: 0, right: 24, bottom: 16, left: 24 });
    expect(COMMON_DEFAULTS.backgroundColor).toBeNull();
    expect(COMMON_DEFAULTS.hideOnMobile).toBe(false);
  });
});
