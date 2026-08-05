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

  it('vlastnost, kterou emitter ignoruje, se dá vypnout a v panelu není', () => {
    // Mezera: odsazení posílá `SpacerBlockView` natvrdo nulové.
    const spacer = contentGroups({ padding: false }).flatMap((g) => g.props.map((p) => p.key));
    expect(spacer).not.toContain('padding');
    expect(spacer).toContain('backgroundColor');
    // Patička: `hideOnMobile` posílá emitter natvrdo `false`.
    const footer = contentGroups({ visibility: false, hideOnMobile: false }).flatMap((g) =>
      g.props.map((p) => p.key),
    );
    expect(footer).not.toContain('hideOnMobile');
    expect(footer).toContain('padding');
  });

  it('výchozí odsazení odpovídá tabulce z části 3, 3.2', () => {
    expect(COMMON_DEFAULTS.padding).toEqual({ top: 0, right: 24, bottom: 16, left: 24 });
    expect(COMMON_DEFAULTS.backgroundColor).toBeNull();
    expect(COMMON_DEFAULTS.hideOnMobile).toBe(false);
  });
});
