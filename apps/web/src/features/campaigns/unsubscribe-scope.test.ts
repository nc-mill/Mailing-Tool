import { describe, expect, it } from 'vitest';
import { NO_SELECTION } from './no-selection';
import {
  unsubscribeFieldValue,
  unsubscribeScopeChanged,
  unsubscribeScopeFor,
} from './unsubscribe-scope';

/**
 * Rozsah odhlášení odvozený z publika.
 *
 * Není to kosmetika obrazovky: odhlášení ze seznamu je v jádru
 * `UPDATE list_subscriptions WHERE contact_id = ? AND list_id = ?`, takže komu
 * ten seznam nesedí, tomu kliknutí na odhlášení nezmění ani řádek. Pravidlo tady
 * hlídá, aby taková kombinace z obrazovky vůbec nemohla vzejít.
 */
describe('rozsah odhlášení podle publika', () => {
  it('u jediného seznamu odhlašuje z něj, protože na něm každý příjemce je', () => {
    expect(unsubscribeScopeFor({ lists: ['list-1'], segments: [] })).toEqual({
      kind: 'list',
      listId: 'list-1',
    });
  });

  /**
   * Jedním identifikátorem se nedá říct „odhlas ho z těchhle tří". Kterýkoli
   * vybraný by nechal příjemce ze zbylých seznamů s mrtvým odkazem.
   */
  it('u víc seznamů odhlašuje ze všeho a řekne proč', () => {
    expect(unsubscribeScopeFor({ lists: ['list-1', 'list-2'], segments: [] })).toEqual({
      kind: 'global',
      reason: 'many',
    });
  });

  it('bez publika odhlašuje ze všeho, ale odlišuje to od víc seznamů', () => {
    expect(unsubscribeScopeFor({ lists: [], segments: [] })).toEqual({
      kind: 'global',
      reason: 'empty',
    });
  });

  it('se segmentem nechává volbu na uživateli, odvodit tam není z čeho', () => {
    expect(unsubscribeScopeFor({ lists: [], segments: ['seg-1'] })).toEqual({ kind: 'choice' });
  });

  /**
   * SMÍŠENÉ PUBLIKUM. Odvodit rozsah z toho jednoho seznamu by byla past: lidé
   * ze segmentu na něm být nemusí a jejich odhlášení by neudělalo nic.
   */
  it('u seznamu i segmentu naráz se rozsah neodvozuje, ale volí', () => {
    expect(unsubscribeScopeFor({ lists: ['list-1'], segments: ['seg-1'] })).toEqual({
      kind: 'choice',
    });
  });
});

describe('hodnota, kterou o odvozeném rozsahu pošle formulář', () => {
  /**
   * Odvozený rozsah se posílá VŽDY. Vynechané pole by v databázi nechalo
   * hodnotu z dřívějška a kampaň by se chovala jinak, než co je na obrazovce.
   */
  it('u jediného seznamu pošle jeho identifikátor', () => {
    expect(unsubscribeFieldValue({ kind: 'list', listId: 'list-1' })).toBe('list-1');
  });

  it('u globálního rozsahu pošle zástupnou hodnotu, ne prázdno bez významu', () => {
    expect(unsubscribeFieldValue({ kind: 'global', reason: 'many' })).toBe(NO_SELECTION);
    expect(unsubscribeFieldValue({ kind: 'global', reason: 'empty' })).toBe(NO_SELECTION);
  });
});

describe('upozornění na změnu uloženého rozsahu', () => {
  it('hlásí, že vybraný seznam přestal platit, když publikum narostlo', () => {
    expect(unsubscribeScopeChanged({ kind: 'global', reason: 'many' }, 'list-1')).toBe(true);
  });

  it('hlásí i výměnu jednoho seznamu za jiný', () => {
    expect(unsubscribeScopeChanged({ kind: 'list', listId: 'list-2' }, 'list-1')).toBe(true);
  });

  it('u nezměněného seznamu mlčí', () => {
    expect(unsubscribeScopeChanged({ kind: 'list', listId: 'list-1' }, 'list-1')).toBe(false);
  });

  /**
   * Přechod z prázdna na odvozený seznam se nehlásí. Týká se každé starší
   * kampaně a na obrazovce je napsaný větou o tom, co se stane, takže by
   * z upozornění byl šum, který se přestane číst.
   */
  it('přechod z prázdné hodnoty nehlásí, ten je napsaný v textu pole', () => {
    expect(unsubscribeScopeChanged({ kind: 'list', listId: 'list-1' }, null)).toBe(false);
    expect(unsubscribeScopeChanged({ kind: 'global', reason: 'empty' }, null)).toBe(false);
  });

  it('u volby nehlásí nic, tam si hodnotu drží uživatel', () => {
    expect(unsubscribeScopeChanged({ kind: 'choice' }, 'list-1')).toBe(false);
  });
});
