import { NO_SELECTION } from './no-selection';

/**
 * Rozsah odhlášení, odvozený z PUBLIKA kampaně.
 *
 * CO `unsubscribe_list_id` DĚLÁ. Odesílač z něj skládá rozsah odhlašovacího
 * tokenu (`listID` v `apps/sender/internal/app/worker.go`). Prázdná hodnota
 * znamená nulové UUID, tedy GLOBÁLNÍ odhlášení: příjemce se odepíše ze všech
 * seznamů, přibude do potlačení a nedostane od projektu vůbec nic. Vyplněná
 * hodnota znamená odhlášení Z JEDNOHO SEZNAMU.
 *
 * PROČ SE TO ODVOZUJE A NENECHÁVÁ NA UŽIVATELI. Odhlášení ze seznamu je v jádru
 * `UPDATE list_subscriptions WHERE contact_id = ? AND list_id = ?`
 * (`contacts/lists/unsubscribe.ts`). Kdo na tom seznamu není, tomu ten příkaz
 * nezmění ani řádek: klikne na odhlášení, nic se nestane a pošta mu chodí dál.
 * Globální odhlášení proti tomu zapíše potlačení a zastaví všechno. Volba tedy
 * není otázka vkusu, ale otázka, jestli odhlašovací odkaz vůbec funguje, a
 * u většiny publik má právě jednu správnou odpověď:
 *
 *   * PRÁVĚ JEDEN SEZNAM. Každý příjemce je na něm z podstaty výběru, takže
 *     odhlášení z něj vždycky projde. Je to zároveň to, co uživatel čeká:
 *     posílám na „Novinky", odhlašuje se z „Novinek".
 *   * VÍC SEZNAMŮ. Jedním identifikátorem se nedá říct „odhlas ho z těchhle
 *     tří". Kterýkoli vybraný by nechal příjemce ze zbylých seznamů s mrtvým
 *     odhlašovacím odkazem, takže platí globální rozsah. Odhlásit ze všeho je
 *     vždycky přípustné a nikdy to není v neprospěch příjemce.
 *   * ŽÁDNÉ PUBLIKUM. Zatím není z čeho odvozovat; platí globální rozsah, dokud
 *     se publikum nevybere.
 *   * SEGMENT V PUBLIKU. Segment není seznam, takže odvodit nejde nic a volba
 *     dává smysl. Tohle je jediný případ, kdy se uživatel opravdu ptá.
 *
 * SMÍŠENÉ PUBLIKUM (seznam i segment naráz) spadá pod poslední případ. Odvodit
 * ho z toho seznamu by byla past: lidé ze segmentu na něm být nemusí a jejich
 * odhlášení by neudělalo nic.
 */
export type UnsubscribeScope =
  /** Právě jeden seznam v publiku: odhlašuje se z něj a vybírat není z čeho. */
  | { kind: 'list'; listId: string }
  /** Odhlašuje se ze všeho. `reason` rozlišuje, PROČ, kvůli textu na obrazovce. */
  | { kind: 'global'; reason: 'empty' | 'many' }
  /** Aspoň jeden segment: rozsah si volí uživatel. */
  | { kind: 'choice' };

export function unsubscribeScopeFor(include: {
  lists: readonly string[];
  segments: readonly string[];
}): UnsubscribeScope {
  if (include.segments.length > 0) return { kind: 'choice' };
  if (include.lists.length === 1) return { kind: 'list', listId: include.lists[0]! };
  return { kind: 'global', reason: include.lists.length === 0 ? 'empty' : 'many' };
}

/**
 * Hodnota, kterou o odvozeném rozsahu pošle formulář.
 *
 * Odvozený rozsah se posílá VŽDY, i když je to zástupné „nic". Kdyby se pole
 * vynechalo, zůstala by v databázi hodnota z dřívějška a kampaň by se chovala
 * jinak, než co je na obrazovce napsané. U kampaně s vybraným segmentem se
 * hodnota nebere odsud, tam ji nese rozbalovací seznam.
 */
export function unsubscribeFieldValue(scope: UnsubscribeScope): string {
  return scope.kind === 'list' ? scope.listId : NO_SELECTION;
}

/**
 * Změní odvozený rozsah to, co má kampaň uložené?
 *
 * Ptá se jen na hodnotu, kterou uživatel kdysi VYBRAL, tedy na neprázdnou.
 * Přechod z prázdna na odvozený seznam se hlásit nemusí: ten je na obrazovce
 * napsaný větou o tom, co se stane, a týká se každé starší kampaně, takže by
 * z upozornění byl šum, který se přestane číst.
 */
export function unsubscribeScopeChanged(scope: UnsubscribeScope, storedId: string | null): boolean {
  if (storedId === null || scope.kind === 'choice') return false;
  return scope.kind === 'global' || scope.listId !== storedId;
}
