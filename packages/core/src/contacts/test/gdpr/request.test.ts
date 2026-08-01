import { describe, expect, it } from 'vitest';
import {
  GDPR_REQUEST_TYPES,
  canTransition,
  computeDueAt,
  computeExtendedUntil,
  isOverdue,
} from '../../gdpr/request';

describe('lhůty podle článku 12 odst. 3', () => {
  it('KRITÉRIUM 66: due_at je přesně měsíc od podání', () => {
    expect(computeDueAt(new Date('2026-01-15T10:00:00.000Z'))).toEqual(
      new Date('2026-02-15T10:00:00.000Z'),
    );
  });

  it('měsíc se počítá kalendářně, ne jako třicet dní', () => {
    expect(computeDueAt(new Date('2026-01-31T10:00:00.000Z'))).toEqual(
      new Date('2026-02-28T10:00:00.000Z'),
    );
  });

  it('přestupný rok', () => {
    expect(computeDueAt(new Date('2028-01-31T10:00:00.000Z'))).toEqual(
      new Date('2028-02-29T10:00:00.000Z'),
    );
  });

  it('KRITÉRIUM 66: prodloužení přidá dva měsíce k původní lhůtě', () => {
    expect(computeExtendedUntil(new Date('2026-02-15T10:00:00.000Z'))).toEqual(
      new Date('2026-04-15T10:00:00.000Z'),
    );
  });

  it('žádost je po termínu, když je due_at v minulosti a není vyřízená', () => {
    const past = new Date(Date.now() - 86400000);
    expect(isOverdue({ dueAt: past, extendedUntil: null, status: 'processing' })).toBe(true);
    expect(isOverdue({ dueAt: past, extendedUntil: null, status: 'completed' })).toBe(false);
  });

  it('prodloužená lhůta přebíjí původní', () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    expect(isOverdue({ dueAt: past, extendedUntil: future, status: 'processing' })).toBe(false);
  });
});

describe('typy žádostí', () => {
  it('šest typů podle nařízení', () => {
    expect(GDPR_REQUEST_TYPES).toEqual([
      'access',
      'portability',
      'erasure',
      'rectification',
      'restriction',
      'objection',
    ]);
  });
});

describe('přechody stavů', () => {
  it('žádost z administrace jde přes ověření', () => {
    expect(canTransition('received', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'processing')).toBe(true);
  });

  it('žádost ze stránky předvoleb je ověřená držením tokenu', () => {
    expect(canTransition('received', 'processing')).toBe(true);
  });

  it('vyřízená žádost se už nemění', () => {
    expect(canTransition('completed', 'processing')).toBe(false);
    expect(canTransition('rejected', 'processing')).toBe(false);
  });

  it('zamítnutí je možné z každého nedokončeného stavu', () => {
    for (const from of ['received', 'verifying', 'processing'] as const) {
      expect(canTransition(from, 'rejected')).toBe(true);
    }
  });
});
