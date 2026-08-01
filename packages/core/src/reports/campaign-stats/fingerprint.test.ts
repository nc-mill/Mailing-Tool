import { describe, expect, it } from 'vitest';
import { emptyCounts } from '../metrics/counts';
import { detectStaleVersion, statsFingerprint } from './fingerprint';

const base = {
  version: 4711,
  updatedAt: new Date('2026-07-31T14:00:00.000Z'),
  counts: { ...emptyCounts(), sent: 12043, delivered: 11890, opensUnique: 3120 },
};

describe('statsFingerprint', () => {
  it('je pro stejný vstup stejný', () => {
    expect(statsFingerprint(base)).toBe(statsFingerprint({ ...base }));
  });

  it('se změní se změnou verze', () => {
    expect(statsFingerprint({ ...base, version: 4712 })).not.toBe(statsFingerprint(base));
  });

  it('se změní i tehdy, když se změní počty a verze zůstane stejná', () => {
    const changed = { ...base, counts: { ...base.counts, opensUnique: 3121 } };
    expect(statsFingerprint(changed)).not.toBe(statsFingerprint(base));
  });
});

describe('detectStaleVersion', () => {
  it('nehlásí nic, když se s počty zvýšila i verze', () => {
    const next = { ...base, version: 4712, counts: { ...base.counts, opensUnique: 3121 } };
    expect(detectStaleVersion(base, next)).toBe(false);
  });

  it('nahlásí zapisovatele, který změnil počty a nezvýšil verzi', () => {
    const next = { ...base, counts: { ...base.counts, opensUnique: 3121 } };
    expect(detectStaleVersion(base, next)).toBe(true);
  });

  it('nehlásí nic, když se nezměnilo nic', () => {
    expect(detectStaleVersion(base, { ...base })).toBe(false);
  });
});
