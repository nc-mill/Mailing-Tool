import { describe, expect, it } from 'vitest';
import {
  allowsMeasurement,
  pickEffectiveConsent,
  toMeasurementConsent,
  type ConsentPrecedenceRow,
} from './consents';

/**
 * Pravidlo přednosti souhlasů jako ČISTÁ FUNKCE, tedy bez databáze.
 *
 * Chování nad skutečnými daty hlídá `contacts/test/lists/consent-driven.db.test.ts`.
 * Tyhle testy jsou tu proto, že totéž pravidlo od 7. 8. 2026 čte i rozhraní:
 * formulář kontaktu podle něj pozná, jestli po zaškrtnutí seznamu odejde
 * potvrzovací, nebo uvítací e-mail. Kdyby si pravidlo opsalo, rozešlo by se
 * s tím, co doopravdy udělá server, a poznalo by se to až v doručené poště.
 */

const LIST = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const row = (
  over: Partial<ConsentPrecedenceRow> & Pick<ConsentPrecedenceRow, 'status'>,
): ConsentPrecedenceRow => ({
  scope_list_id: null,
  purpose: 'email_marketing',
  ...over,
});

describe('pickEffectiveConsent', () => {
  it('bez řádků souhlas nemáme', () => {
    expect(pickEffectiveConsent([], { listId: LIST })).toBeNull();
  });

  it('projektový souhlas dosáhne i na seznam, ve kterém kontakt nikdy nebyl', () => {
    const rows = [row({ status: 'granted', scope_list_id: null })];
    expect(pickEffectiveConsent(rows, { listId: LIST })).not.toBeNull();
  });

  it('souhlas pro cizí seznam na tenhle seznam nedosáhne', () => {
    const rows = [row({ status: 'granted', scope_list_id: OTHER })];
    expect(pickEffectiveConsent(rows, { listId: LIST })).toBeNull();
  });

  /**
   * Odvolání je NOVĚJŠÍ řádek, ne smazání staršího. Kdyby se hledal jen první
   * udělený souhlas, odvolání by se přehlédlo a člověk by se dostal do rozesílky
   * poté, co si to výslovně zakázal.
   */
  it('novější odvolání přebije starší udělený souhlas', () => {
    const rows = [
      row({ status: 'withdrawn', scope_list_id: null }),
      row({ status: 'granted', scope_list_id: null }),
    ];
    expect(pickEffectiveConsent(rows, { listId: LIST })).toBeNull();
  });

  it('odvolání pro jeden seznam platí jen u něj, jinde projektový souhlas zůstává', () => {
    const rows = [
      row({ status: 'withdrawn', scope_list_id: LIST }),
      row({ status: 'granted', scope_list_id: null }),
    ];
    expect(pickEffectiveConsent(rows, { listId: LIST })).toBeNull();
    expect(pickEffectiveConsent(rows, { listId: OTHER })).not.toBeNull();
  });

  /** Odvolání pro CIZÍ seznam se do porovnání nesmí dostat ani jako odvolání. */
  it('odvolání pro cizí seznam tenhle seznam neovlivní', () => {
    const rows = [
      row({ status: 'withdrawn', scope_list_id: OTHER }),
      row({ status: 'granted', scope_list_id: null }),
    ];
    expect(pickEffectiveConsent(rows, { listId: LIST })).not.toBeNull();
  });

  it('souhlas k jinému účelu se nepočítá', () => {
    const rows = [row({ status: 'granted', purpose: 'analytics' })];
    expect(pickEffectiveConsent(rows, { listId: LIST })).toBeNull();
    expect(pickEffectiveConsent(rows, { listId: LIST, purpose: 'analytics' })).not.toBeNull();
  });
});

/**
 * Pravidlo pro měření chování. Je záměrně JINÉ než přednost podle rozsahu:
 * měření nemá rozsah na seznam, takže se neptá „dosáhne tenhle souhlas na
 * tenhle seznam", ale „řekl ten člověk ne".
 */
describe('allowsMeasurement', () => {
  it('odvolaný souhlas měření zastaví', () => {
    expect(allowsMeasurement('withdrawn')).toBe(false);
  });

  it('udělený souhlas měření povolí', () => {
    expect(allowsMeasurement('granted')).toBe(true);
  });

  /**
   * NEJDŮLEŽITĚJŠÍ ŘÁDEK CELÉHO PRAVIDLA. Kdyby chybějící záznam znamenal
   * zákaz, přestalo by po nasazení fungovat měření všem kontaktům v každé
   * instalaci naráz: účel `analytics` nemá dnes v `contact_consent_state` ani
   * jeden řádek. Před tímhle pravidlem stojí souhlas návštěvníka v prohlížeči
   * (`ConsentGate` v SDK) a projektový přepínač `web_tracking_enabled`, takže
   * bez souhlasu se neměří ani tak.
   */
  it('chybějící záznam měření nezastaví, protože souhlas se bere jinde', () => {
    expect(allowsMeasurement('not_recorded')).toBe(true);
  });
});

describe('toMeasurementConsent', () => {
  it('chybějící i neznámou hodnotu hlásí jako nevyjádřenou, ne jako souhlas', () => {
    expect(toMeasurementConsent(null)).toBe('not_recorded');
    expect(toMeasurementConsent(undefined)).toBe('not_recorded');
    expect(toMeasurementConsent('cosi')).toBe('not_recorded');
  });

  it('zapsané stavy převede beze změny', () => {
    expect(toMeasurementConsent('granted')).toBe('granted');
    expect(toMeasurementConsent('withdrawn')).toBe('withdrawn');
  });
});
