import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csReports from '@mlain/i18n/messages/cs/reports.json' with { type: 'json' };
import enReports from '@mlain/i18n/messages/en/reports.json' with { type: 'json' };
import { composeTitle } from './titles';
import type { TimelineRow } from './types';

function translatorFor(locale: 'cs' | 'en') {
  const messages = { reports: locale === 'cs' ? csReports : enReports };
  const t = createTranslator({ locale, messages });
  return (key: string, values: Record<string, unknown>): string =>
    t(`reports.${key}` as never, values as never) as unknown as string;
}

function row(type: string, slots: Record<string, string | number> = {}): TimelineRow {
  return { id: 'x', occurredAt: new Date(), source: 'email', type, slots };
}

describe('věty časové osy v katalogu', () => {
  it('skloňuje sloveso podle rodu kontaktu (kritérium 61 části 6)', () => {
    const cs = translatorFor('cs');
    expect(composeTitle(cs, row('message_opened', { campaign: 'Letní výprodej' }), 'female')).toBe(
      'Otevřela kampaň Letní výprodej',
    );
    expect(composeTitle(cs, row('message_opened', { campaign: 'Letní výprodej' }), 'male')).toBe(
      'Otevřel kampaň Letní výprodej',
    );
  });

  it('u neznámého rodu použije podstatné jméno, ne mužský tvar', () => {
    const cs = translatorFor('cs');
    const title = composeTitle(
      cs,
      row('message_opened', { campaign: 'Letní výprodej' }),
      'unknown',
    );
    expect(title).toBe('Otevření kampaně Letní výprodej');
    expect(title.startsWith('Otevřel ')).toBe(false);
  });

  it('má všechny typy položek v obou jazycích', () => {
    const types = [
      'message_sent',
      'message_failed',
      'message_delivered',
      'message_opened',
      'message_clicked',
      'message_bounced',
      'message_complained',
      'message_unsubscribed',
      'page_view',
      'session_started',
      'contact_created',
      'list_subscribed',
      'list_unsubscribed',
      'consent_granted',
      'consent_withdrawn',
      'neznamy_typ',
    ];
    for (const locale of ['cs', 'en'] as const) {
      const translate = translatorFor(locale);
      for (const type of types) {
        const title = composeTitle(
          translate,
          row(type, { campaign: 'C', link: 'L', list: 'S', page: 'P', name: 'n' }),
          'female',
        );
        expect(title.length, `${locale}/${type}`).toBeGreaterThan(0);
        expect(title).not.toContain('reports.');
      }
    }
  });

  it('katalogy neobsahují dlouhou pomlčku', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    for (const catalog of [csReports, enReports]) {
      expect(JSON.stringify(catalog)).not.toContain(EM_DASH);
    }
  });

  it('klíče cs a en se přesně shodují', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];
    expect(flatten(csReports).sort()).toEqual(flatten(enReports).sort());
  });
});
