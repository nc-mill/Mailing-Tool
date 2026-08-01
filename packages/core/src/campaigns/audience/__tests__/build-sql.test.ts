import { describe, expect, it, vi } from 'vitest';
import { buildAudienceSql } from '../build-sql';
import type { AudiencePort } from '../../ports';

function portReturning(): AudiencePort {
  return {
    compileToSql: vi.fn(async ({ alias, paramOffset }) => ({
      sql: `SELECT ${alias}.id AS contact_id FROM contacts ${alias} WHERE ${alias}.workspace_id = $${paramOffset + 1}`,
      params: ['ws'],
    })),
    countGates: vi.fn(),
  } as unknown as AudiencePort;
}

const audience = {
  include: { lists: ['l1'], segments: ['s1'] },
  exclude: { lists: ['l2'], segments: [] },
};

describe('skladani publika', () => {
  it('vola kompilator dvakrat, pro include a pro exclude', async () => {
    const port = portReturning();
    await buildAudienceSql(port, {
      workspaceId: 'ws',
      audience,
      paramOffset: 2,
      asOf: new Date(0),
    });
    expect(port.compileToSql).toHaveBeenCalledTimes(2);
  });

  it('exclude dostane jiny alias, jinak by se poddotazy prekryly', async () => {
    const port = portReturning();
    await buildAudienceSql(port, {
      workspaceId: 'ws',
      audience,
      paramOffset: 0,
      asOf: new Date(0),
    });
    const calls = (port.compileToSql as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].alias).toBe('inc');
    expect(calls[1]![0].alias).toBe('exc');
  });

  it('paramOffset druheho volani navazuje na delku parametru prvniho', async () => {
    const port = portReturning();
    await buildAudienceSql(port, {
      workspaceId: 'ws',
      audience,
      paramOffset: 3,
      asOf: new Date(0),
    });
    const calls = (port.compileToSql as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].paramOffset).toBe(3);
    expect(calls[1]![0].paramOffset).toBe(4);
  });

  it('prazdny exclude kompilator vubec nevola', async () => {
    const port = portReturning();
    const out = await buildAudienceSql(port, {
      workspaceId: 'ws',
      audience: { include: { lists: ['l1'], segments: [] }, exclude: { lists: [], segments: [] } },
      paramOffset: 0,
      asOf: new Date(0),
    });
    expect(port.compileToSql).toHaveBeenCalledTimes(1);
    expect(out.sql).not.toContain('NOT IN');
  });

  it('vysledek je vyraz pro WHERE, bez ORDER BY, LIMIT a stredniku', async () => {
    const out = await buildAudienceSql(portReturning(), {
      workspaceId: 'ws',
      audience,
      paramOffset: 0,
      asOf: new Date(0),
    });
    expect(out.sql).toContain('IN (');
    expect(out.sql).toContain('NOT IN (');
    expect(out.sql).not.toMatch(/order by|limit|;/i);
  });
});
