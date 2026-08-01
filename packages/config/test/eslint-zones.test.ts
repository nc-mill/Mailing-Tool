import { describe, expect, it } from 'vitest';
import { PACKAGE_DIRECTORIES, PACKAGE_GRAPH } from '../src/package-graph';
import { restrictedPathZones } from '../eslint/index.js';

describe('zóny pro import/no-restricted-paths', () => {
  const zones = restrictedPathZones();
  const has = (target: string, from: string): boolean =>
    zones.some((zone) => zone.target === target && zone.from === from);

  it('pokrývá každou zakázanou dvojici', () => {
    expect(has('./packages/db', './packages/core'), 'db nesmí sahat do core').toBe(true);
    expect(has('./packages/contracts', './packages/i18n'), 'contracts nesmí nikam').toBe(true);
    expect(has('./apps/worker', './packages/ui'), 'worker nesmí do ui').toBe(true);
  });

  it('nezakazuje povolenou hranu', () => {
    expect(has('./packages/db', './packages/contracts'), 'db do contracts smí').toBe(false);
    expect(has('./packages/core', './packages/emails'), 'core do emails smí').toBe(false);
  });

  it('má zónu pro každou dvojici, kterou graf nepovoluje', () => {
    const workspaceCount = Object.keys(PACKAGE_DIRECTORIES).length;
    const expected = Object.values(PACKAGE_GRAPH).reduce(
      (sum, allowed) => sum + (workspaceCount - 1 - allowed.length),
      0,
    );
    expect(zones).toHaveLength(expected);
  });
});
