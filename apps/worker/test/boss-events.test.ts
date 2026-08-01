import { describe, expect, it } from 'vitest';
import { events, PgBoss } from 'pg-boss';
import { BOSS_EVENTS } from '../src/boss';

describe('události pg-boss', () => {
  it('worker se přihlašuje jen k událostem, které pg-boss opravdu má', () => {
    const known = Object.keys(events);
    for (const name of BOSS_EVENTS) {
      expect(known, `pg-boss nezná událost "${name}", výčet je ${known.join(', ')}`).toContain(
        name,
      );
    }
  });

  it('událost maintenance neexistuje, readiness na ní stát nesmí', () => {
    expect(Object.keys(events)).not.toContain('maintenance');
  });

  it('pg-boss se importuje pojmenovaně, ne jako default', () => {
    expect(typeof PgBoss).toBe('function');
  });

  it('readiness workeru se opírá o metodu, kterou pg-boss vydává', () => {
    expect(typeof PgBoss.prototype.isInstalled).toBe('function');
  });
});
