import { describe, expect, it } from 'vitest';
import { SUPPRESSION_REASONS } from '../../contacts/suppression/rank';
import {
  transactionalVerdict,
  unclassifiedSuppressionReasons,
} from '../../contacts/suppression/transactional';
import { missingDataPaths } from '../send';

/**
 * Tahle sada případů má PŘESNÝ Go protějšek v
 * `apps/sender/internal/outbox/suppression_reason_test.go`. Kdyby se odpovědi
 * rozešly, sender propustí, co endpoint zablokoval, nebo naopak, a projeví se
 * to tím, že člověku nedojde reset hesla.
 */
describe('blokace adresy versus transakční pošta', () => {
  it('tvrdé důvody blokují i transakční poštu', () => {
    for (const reason of [
      'gdpr_erasure',
      'complaint',
      'hard_bounce',
      'ses_suppressed',
      'soft_bounce_threshold',
      'invalid',
    ]) {
      expect(transactionalVerdict(reason), reason).toBe('block');
    }
  });

  it('odhlášení z marketingu transakční poštu neblokuje', () => {
    expect(transactionalVerdict('global_unsubscribe')).toBe('allow');
    expect(transactionalVerdict('one_click_unsubscribe')).toBe('allow');
  });

  it('ruční blokace a řádek z importu projdou s varováním', () => {
    expect(transactionalVerdict('manual')).toBe('allow_with_warning');
    expect(transactionalVerdict('import')).toBe('allow_with_warning');
  });

  it('neznámý důvod blokuje, protože neodeslat je bezpečnější než odeslat', () => {
    expect(transactionalVerdict('neco_noveho')).toBe('block');
  });

  it('každý důvod z katalogu je zatříděný', () => {
    expect(unclassifiedSuppressionReasons()).toEqual([]);
    // Pojistka proti tomu, aby test prošel nad prázdným katalogem.
    expect(SUPPRESSION_REASONS.length).toBeGreaterThan(5);
  });
});

/**
 * Chybějící proměnná je u transakční pošty CHYBA, ne prázdný řetězec. Kontrakt
 * Liquidu má `strictVariables: false`, což je pro kampaň správně a pro reset
 * hesla katastrofa: vzniklo by z toho `href=""`.
 */
describe('kontrola dodaných proměnných', () => {
  it('najde cestu, kterou šablona chce a volání ji nedodalo', () => {
    expect(missingDataPaths(['data.reset_url'], {})).toEqual(['data.reset_url']);
  });

  it('dodanou cestu nehlásí', () => {
    expect(missingDataPaths(['data.reset_url'], { reset_url: 'https://x.cz' })).toEqual([]);
  });

  it('umí vnořenou cestu', () => {
    expect(missingDataPaths(['data.order.id'], { order: { id: 7 } })).toEqual([]);
    expect(missingDataPaths(['data.order.id'], { order: {} })).toEqual(['data.order.id']);
  });

  it('prázdný řetězec ani nula chybějící NEJSOU', () => {
    expect(missingDataPaths(['data.a', 'data.b'], { a: '', b: 0 })).toEqual([]);
  });

  it('null je dodaná hodnota, protože ji volající poslal vědomě', () => {
    expect(missingDataPaths(['data.a'], { a: null })).toEqual([]);
  });

  it('cesty mimo kořen data se nekontrolují', () => {
    // Chybějící `contact.*` je běžná personalizace, kde je prázdná hodnota
    // správná odpověď. Filtr `default` na to v kontraktu je.
    expect(missingDataPaths(['contact.first_name', 'unsubscribe_url'], {})).toEqual([]);
  });
});
