import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
} from './format';

const PRAGUE = 'Europe/Prague';

describe('formatNumber', () => {
  it('česky odděluje tisíce nezlomitelnou mezerou, ne obyčejnou', () => {
    const value = formatNumber(12480, 'cs');
    expect(value).not.toContain(' '); // obyčejná mezera je chyba, text by se zalomil
    expect(value.replace(/[\u00A0\u202F]/g, ' ')).toBe('12 480');
  });

  it('anglicky odděluje čárkou', () => {
    expect(formatNumber(12480, 'en')).toBe('12,480');
  });
});

describe('formatPercent', () => {
  it('vždy jedno desetinné místo, nikdy zaokrouhlení na celá', () => {
    expect(formatPercent(0.0034, 'cs').replace(/[\u00A0\u202F]/g, ' ')).toBe('0,3 %');
    expect(formatPercent(0.164, 'cs').replace(/[\u00A0\u202F]/g, ' ')).toBe('16,4 %');
    expect(formatPercent(0.164, 'en')).toBe('16.4%');
  });

  it('celé číslo si desetinné místo drží', () => {
    expect(formatPercent(0.5, 'en')).toBe('50.0%');
  });
});

describe('formatDate a formatTime', () => {
  const moment = new Date('2026-07-31T12:38:00.000Z');

  it('respektuje časovou zónu, ne zónu serveru', () => {
    expect(formatTime(moment, 'cs', PRAGUE)).toBe('14:38');
    expect(formatTime(moment, 'cs', 'UTC')).toBe('12:38');
  });

  it('české datum je s tečkami, anglické s názvem měsíce', () => {
    expect(formatDate(moment, 'cs', PRAGUE).replace(/[\u00A0\u202F]/g, ' ')).toBe('31. 7. 2026');
    expect(formatDate(moment, 'en', PRAGUE)).toBe('July 31, 2026');
  });

  it('datum s časem spojuje obojí podle jazyka', () => {
    expect(formatDateTime(moment, 'cs', PRAGUE)).toContain('14:38');
    expect(formatDateTime(moment, 'en', PRAGUE)).toContain('2:38');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-31T14:38:00.000Z');

  it('do minuty říká „před chvílí"', () => {
    expect(formatRelativeTime(new Date('2026-07-31T14:37:40.000Z'), 'cs', now)).toBe('před chvílí');
    expect(formatRelativeTime(new Date('2026-07-31T14:37:40.000Z'), 'en', now)).toBe('just now');
  });

  it('do sedmi dní používá relativní tvar', () => {
    expect(formatRelativeTime(new Date('2026-07-31T14:34:00.000Z'), 'cs', now)).toBe(
      'před 4 minutami',
    );
    expect(formatRelativeTime(new Date('2026-07-28T14:38:00.000Z'), 'en', now)).toBe('3 days ago');
  });

  it('starší než sedm dní přepne na absolutní datum', () => {
    const older = new Date('2026-06-12T14:38:00.000Z');
    expect(formatRelativeTime(older, 'cs', now, PRAGUE).replace(/[\u00A0\u202F]/g, ' ')).toBe(
      '12. 6. 2026',
    );
  });
});

describe('formatFileSize', () => {
  it('používá jedno desetinné místo a lokalizovanou desetinnou čárku', () => {
    expect(formatFileSize(13002342, 'cs').replace(/[\u00A0\u202F]/g, ' ')).toBe('12,4 MB');
    expect(formatFileSize(13002342, 'en')).toBe('12.4 MB');
  });

  it('bajty nezobrazuje s desetinným místem', () => {
    expect(formatFileSize(512, 'en')).toBe('512 B');
  });
});
