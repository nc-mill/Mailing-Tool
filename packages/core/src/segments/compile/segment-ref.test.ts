import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import { compileSegmentRefCondition, resetChildAlias } from './segment-ref';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws');
  b.add(new Date());
  b.add('Europe/Prague');
  return b;
}

const SEG_A = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60a1';
const SEG_B = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60b2';

describe('segment reference', () => {
  it('uses segment_members for a static segment', () => {
    const sql = compileSegmentRefCondition('a', SEG_A, 'in', { kind: 'static' }, bag(), () => '');
    expect(sql).toContain('segment_members sm');
    expect(sql).toContain('sm.contact_id = a.id');
    expect(sql).toContain('sm.workspace_id = a.workspace_id');
  });

  it('inlines a compiled subexpression for a dynamic segment', () => {
    resetChildAlias();
    const sql = compileSegmentRefCondition(
      'a',
      SEG_B,
      'in',
      { kind: 'dynamic' },
      bag(),
      (childAlias) => `${childAlias}.status = 'active'`,
    );
    expect(sql).toContain('EXISTS (SELECT 1 FROM contacts');
    expect(sql).toMatch(/s\d\.status = 'active'/);
    expect(sql).toMatch(/s\d\.id = a\.id/);
  });

  it('negates with not_in', () => {
    const sql = compileSegmentRefCondition(
      'a',
      SEG_A,
      'not_in',
      { kind: 'static' },
      bag(),
      () => '',
    );
    expect(sql.startsWith('(NOT ')).toBe(true);
  });

  it('gives each nested reference its own alias', () => {
    resetChildAlias();
    const b = bag();
    const first = compileSegmentRefCondition(
      'a',
      SEG_A,
      'in',
      { kind: 'dynamic' },
      b,
      (alias) => `${alias}.status = 'active'`,
    );
    const second = compileSegmentRefCondition(
      'a',
      SEG_B,
      'in',
      { kind: 'dynamic' },
      b,
      (alias) => `${alias}.status = 'active'`,
    );
    const aliasOf = (sql: string): string => sql.match(/FROM contacts (s\d+)/)?.[1] ?? '';
    expect(aliasOf(first)).not.toBe(aliasOf(second));
    expect(aliasOf(first)).not.toBe('');
  });

  it('parameterises the segment id, never a literal', () => {
    const b = bag();
    compileSegmentRefCondition('a', SEG_A, 'in', { kind: 'static' }, b, () => '');
    expect(b.values).toContain(SEG_A);
  });
});
