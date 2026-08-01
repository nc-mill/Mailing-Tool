import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import {
  compileConsentCondition,
  compileListCondition,
  compileSuppressionCondition,
  compileTagCondition,
} from './tag-list-consent';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws');
  b.add(new Date());
  b.add('Europe/Prague');
  return b;
}

describe('tag, list, consent and suppression', () => {
  it('compiles has_all by comparing cardinality of the same parameter', () => {
    const b = bag();
    const sql = compileTagCondition('a', 'has_all', ['t1', 't2'], b);
    expect(sql).toContain('cardinality($4::uuid[])');
    expect(sql).toContain('= ANY($4::uuid[])');
  });

  it('list membership never accepts pending and honours snooze', () => {
    const sql = compileListCondition('a', 'l1', 'is_member', bag());
    expect(sql).toContain("ls.status = 'confirmed'");
    expect(sql).toContain('ls.snooze_until IS NULL OR ls.snooze_until <= $2::timestamptz');
  });

  it('is_pending selects pending, not confirmed', () => {
    const sql = compileListCondition('a', 'l1', 'is_pending', bag());
    expect(sql).toContain("ls.status = 'pending'");
    expect(sql).not.toContain("ls.status = 'confirmed'");
  });

  it('is_missing means no row at all', () => {
    const sql = compileConsentCondition('a', 'email_marketing', 'is_missing', bag());
    expect(sql.startsWith('(NOT EXISTS')).toBe(true);
  });

  it('suppression checks both branches and removed_at', () => {
    const sql = compileSuppressionCondition('a', 'is_suppressed');
    expect(sql).toContain('su.removed_at IS NULL');
    expect(sql).toContain('su.fingerprint = ANY(a.email_fingerprints)');
  });

  it('scopes every subquery by workspace_id, not only by contact_id', () => {
    expect(compileTagCondition('a', 'has_any', ['t1'], bag())).toContain(
      'ct.workspace_id = a.workspace_id',
    );
    expect(compileListCondition('a', 'l1', 'is_member', bag())).toContain(
      'ls.workspace_id = a.workspace_id',
    );
    expect(compileConsentCondition('a', 'analytics', 'is_granted', bag())).toContain(
      's.workspace_id = a.workspace_id',
    );
  });

  it('parameterises every user supplied id, never a literal', () => {
    const b = bag();
    compileListCondition('a', '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa', 'is_member', b);
    expect(b.values).toContain('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa');
  });
});
