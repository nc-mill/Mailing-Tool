import { describe, expect, it } from 'vitest';
import {
  availableFilters,
  contactLabelKey,
  filterLabelKey,
  parseFilter,
} from './recipients-filter';

describe('parseFilter', () => {
  it('neznámou hodnotu z URL převede na všechny, ne na chybu', () => {
    expect(parseFilter('kdovico')).toBe('all');
    expect(parseFilter(null)).toBe('all');
    expect(parseFilter('machine_open_only')).toBe('machine_open_only');
  });
});

describe('availableFilters', () => {
  it('u kampaně s vypnutým měřením otevření nenabízí filtry otevření', () => {
    const filters = availableFilters({ trackOpens: false, trackClicks: true });
    expect(filters).not.toContain('opened');
    expect(filters).not.toContain('machine_open_only');
    expect(filters).toContain('clicked');
  });

  it('u vypnutého měření prokliků nenabízí filtry prokliků', () => {
    expect(availableFilters({ trackOpens: true, trackClicks: false })).not.toContain('clicked');
  });

  it('odrazy a odhlášení nabízí vždy, ty na měření nezávisí', () => {
    const filters = availableFilters({ trackOpens: false, trackClicks: false });
    expect(filters).toEqual(['all', 'bounced', 'complained', 'unsubscribed']);
  });
});

describe('contactLabelKey', () => {
  it('smazaný a anonymizovaný kontakt má náhradní popisek, ne prázdno', () => {
    expect(contactLabelKey('deleted')).toBe('report.recipients.deletedContact');
    expect(contactLabelKey('erased')).toBe('report.recipients.erasedContact');
    expect(contactLabelKey('active')).toBeNull();
  });
});

describe('filterLabelKey', () => {
  it('každý nabízený filtr má klíč, který v katalogu existuje', async () => {
    const catalog = (await import('@mlain/i18n/messages/cs/reports.json')).default as {
      report: { recipients: Record<string, string> };
    };
    for (const filter of availableFilters({ trackOpens: true, trackClicks: true })) {
      const key = filterLabelKey(filter).replace('report.recipients.', '');
      expect(catalog.report.recipients[key], filter).toBeTruthy();
    }
  });
});
