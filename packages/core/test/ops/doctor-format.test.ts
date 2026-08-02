import { describe, expect, it } from 'vitest';
import { exitCodeFor, formatJson, formatReport } from '../../src/ops/doctor/format';
import type { DoctorFinding } from '../../src/ops/doctor/types';

const critical: DoctorFinding = {
  id: 'missing_key_generations',
  severity: 'critical',
  title: 'Instalace nezná pokolení klíče 1, 2',
  detail: 'V suppression listu jsou otisky pod pokoleními, pro která nemá instalace klíč.',
  action: 'Doplňte stará pokolení do SECRET_KEY_PREVIOUS.',
};
const warning: DoctorFinding = {
  id: 'backup_stale',
  severity: 'warning',
  title: 'Poslední záloha je stará 9 dní',
  detail: '',
  action: 'Spusťte mlain backup.',
};
const info: DoctorFinding = {
  id: 'demo_data_present',
  severity: 'info',
  title: 'V projektu Ukázka jsou ukázková data',
  detail: '',
  action: '',
};

describe('exitCodeFor', () => {
  it('bez nálezů vrací 0', () => {
    expect(exitCodeFor([], { strict: false })).toBe(0);
  });

  it('informace nikdy nezvedne návratový kód', () => {
    expect(exitCodeFor([info], { strict: true })).toBe(0);
  });

  it('varování vrací 0 bez --strict a 1 s ním', () => {
    expect(exitCodeFor([warning], { strict: false })).toBe(0);
    expect(exitCodeFor([warning], { strict: true })).toBe(1);
  });

  it('kritický nález vrací 2 vždy, i bez --strict', () => {
    expect(exitCodeFor([critical], { strict: false })).toBe(2);
    expect(exitCodeFor([critical, warning], { strict: true })).toBe(2);
  });
});

describe('formatReport', () => {
  it('řadí kritické nálezy nahoru', () => {
    const out = formatReport([info, warning, critical]);
    expect(out.indexOf('missing_key_generations')).toBeLessThan(out.indexOf('backup_stale'));
    expect(out.indexOf('backup_stale')).toBeLessThan(out.indexOf('demo_data_present'));
  });

  it('u každého nálezu vypíše identifikátor, aby šel dohledat', () => {
    expect(formatReport([critical])).toContain('missing_key_generations');
  });

  it('bez nálezů řekne, že je instalace v pořádku', () => {
    expect(formatReport([])).toContain('v pořádku');
  });
});

describe('formatJson', () => {
  it('vrací strojově čitelný tvar se souhrnem', () => {
    const parsed = JSON.parse(formatJson([critical, warning, info]));
    expect(parsed.summary).toEqual({ critical: 1, warning: 1, info: 1 });
    expect(parsed.findings[0].id).toBe('missing_key_generations');
  });
});
