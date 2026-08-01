import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import { buildEnvelope, ENVELOPE_CONDITIONS, FIXED_PARAM_COUNT } from './envelope';

describe('envelope', () => {
  it('has exactly six conditions plus the audience', () => {
    const bag = new ParamBag(0);
    const sql = buildEnvelope('a', 'true', bag);
    expect(sql).toContain('a.workspace_id = $1');
    expect(sql).toContain('a.deleted_at IS NULL');
    expect(sql).toContain('a.anonymized_at IS NULL');
    expect(sql).toContain("a.status <> 'deleted'");
    expect(sql).toContain('a.processing_restricted = false');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('su.removed_at IS NULL');
    expect(sql).toContain('su.fingerprint = ANY(a.email_fingerprints)');
  });

  it('lists every mandatory condition, so a removal cannot pass unnoticed', () => {
    // Výčtový test schválně. Kdyby někdo obálce ubral podmínku, testy nad
    // jednotlivými řetězci výš by se daly „opravit" smazáním řádku.
    // Tenhle test se musí opravit vědomě a s vysvětlením.
    expect(ENVELOPE_CONDITIONS).toEqual([
      'workspace_id',
      'deleted_at',
      'anonymized_at',
      'status_not_deleted',
      'processing_restricted',
      'suppressions',
    ]);
  });

  it('selects only contact_id and carries no order or limit', () => {
    const sql = buildEnvelope('a', 'true', new ParamBag(0));
    expect(sql.startsWith('SELECT a.id AS contact_id')).toBe(true);
    expect(sql).not.toMatch(/\border by\b/i);
    expect(sql).not.toMatch(/\blimit\b/i);
    expect(sql).not.toContain(';');
  });

  it('reserves three fixed parameters', () => {
    expect(FIXED_PARAM_COUNT).toBe(3);
  });

  it('honours paramOffset', () => {
    const sql = buildEnvelope('a', 'true', new ParamBag(5));
    expect(sql).toContain('a.workspace_id = $6');
  });
});
