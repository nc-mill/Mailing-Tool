import { describe, expect, it } from 'vitest';
import {
  bulkRemovalSummary,
  suppressionAffordance,
  type SuppressionRow,
} from './suppression-affordance';

const NOW = new Date('2026-07-31T12:00:00.000Z');

function row(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    id: 's-1',
    masked_email: 'a***@seznam.cz',
    reason: 'manual',
    created_at: '2026-07-25T12:00:00.000Z',
    ...overrides,
  };
}

describe('suppressionAffordance', () => {
  it('u stížnosti na spam ukáže zámek s vysvětlením, ne tlačítko', () => {
    expect(suppressionAffordance(row({ reason: 'complaint' }), 'owner', NOW)).toEqual({
      kind: 'locked',
      reasonKey: 'suppressions.reason.complaint',
      explanationKey: 'suppressions.complaintLocked',
      values: {},
    });
  });

  it('u výmazu podle GDPR taky zámek, i pro vlastníka', () => {
    const affordance = suppressionAffordance(row({ reason: 'gdpr_erasure' }), 'owner', NOW);
    expect(affordance.kind).toBe('locked');
    expect(affordance.explanationKey).toBe('suppressions.gdprLocked');
  });

  it('u trvalého nedoručení mladšího 30 dní ukáže, kolik dní zbývá', () => {
    const affordance = suppressionAffordance(
      row({ reason: 'hard_bounce', created_at: '2026-07-19T12:00:00.000Z' }),
      'admin',
      NOW,
    );
    expect(affordance).toEqual({
      kind: 'waiting',
      reasonKey: 'suppressions.reason.hardBounce',
      explanationKey: 'suppressions.bounceTooRecent',
      values: { days: 18 },
    });
  });

  it('u trvalého nedoručení staršího 30 dní dovolí odebrání vlastníkovi a správci', () => {
    const old = row({ reason: 'hard_bounce', created_at: '2026-06-01T12:00:00.000Z' });
    expect(suppressionAffordance(old, 'admin', NOW).kind).toBe('removable');
    expect(suppressionAffordance(old, 'owner', NOW).kind).toBe('removable');
  });

  it('editorovi trvalé nedoručení odebrat nedovolí ani po 30 dnech', () => {
    const old = row({ reason: 'hard_bounce', created_at: '2026-06-01T12:00:00.000Z' });
    expect(suppressionAffordance(old, 'editor', NOW).kind).toBe('locked');
  });

  it('u ručního přidání, importu, neplatné adresy a opakovaného nedoručení dovolí odebrání editorovi', () => {
    for (const reason of ['manual', 'import', 'invalid', 'soft_bounce_threshold'] as const) {
      expect(suppressionAffordance(row({ reason }), 'editor', NOW).kind, reason).toBe('removable');
    }
  });

  it('u odhlášení ukáže informaci, protože návrat musí být rozhodnutím toho člověka', () => {
    for (const reason of ['global_unsubscribe', 'one_click_unsubscribe'] as const) {
      const affordance = suppressionAffordance(row({ reason }), 'owner', NOW);
      expect(affordance.kind, reason).toBe('info');
      expect(affordance.explanationKey).toBe('suppressions.unsubscribeSelfService');
    }
  });

  it('prohlížejícímu nedovolí odebrat nic', () => {
    expect(suppressionAffordance(row({ reason: 'manual' }), 'viewer', NOW).kind).toBe('locked');
  });
});

describe('bulkRemovalSummary', () => {
  const rows = [
    row({ id: '1', reason: 'manual' }),
    row({ id: '2', reason: 'import' }),
    row({ id: '3', reason: 'complaint' }),
    row({ id: '4', reason: 'hard_bounce', created_at: '2026-01-01T12:00:00.000Z' }),
  ];

  it('spočítá, kolik z vybraných jde odebrat hromadně', () => {
    const summary = bulkRemovalSummary(rows, new Set(['1', '2', '3', '4']), 'owner', NOW);
    expect(summary).toEqual({ removableIds: ['1', '2'], removable: 2, total: 4, blocked: 2 });
  });

  it('trvalé nedoručení do hromadného odebrání nepatří, ani když už uplynulo 30 dní', () => {
    const summary = bulkRemovalSummary(rows, new Set(['4']), 'owner', NOW);
    expect(summary.removable).toBe(0);
    expect(summary.blocked).toBe(1);
  });

  it('u čistého výběru nehlásí nic zablokovaného', () => {
    const summary = bulkRemovalSummary(rows, new Set(['1', '2']), 'editor', NOW);
    expect(summary).toEqual({ removableIds: ['1', '2'], removable: 2, total: 2, blocked: 0 });
  });
});
