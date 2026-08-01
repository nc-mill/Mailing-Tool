import { describe, expect, it } from 'vitest';
import { selectBackupsToDelete } from '../../src/ops/backup';

const day = (n: number) => new Date(Date.UTC(2026, 6, n, 3, 0, 0));

describe('selectBackupsToDelete', () => {
  const all = [
    { name: 'a', createdAt: day(1) },
    { name: 'b', createdAt: day(2) },
    { name: 'c', createdAt: day(3) },
    { name: 'd', createdAt: day(20) },
    { name: 'e', createdAt: day(21) },
  ];

  it('smaže jen adresáře starší než limit', () => {
    expect(selectBackupsToDelete(all, { now: day(25), retentionDays: 10 })).toEqual(['a', 'b']);
  });

  it('vždy nechá aspoň tři poslední, i kdyby byly všechny staré', () => {
    expect(selectBackupsToDelete(all, { now: day(400), retentionDays: 14 })).toEqual(['a', 'b']);
  });

  it('při třech a méně zálohách nesmaže nic', () => {
    expect(selectBackupsToDelete(all.slice(0, 3), { now: day(400), retentionDays: 1 })).toEqual([]);
  });

  it('nic nesmaže, když je všechno v limitu', () => {
    expect(selectBackupsToDelete(all, { now: day(22), retentionDays: 30 })).toEqual([]);
  });
});
