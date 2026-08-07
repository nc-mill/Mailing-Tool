/**
 * Port na `revokePendingMessages`, který vlastní doména kampaní (P13).
 *
 * PROČ PORT VŮBEC JE. Když se tenhle soubor psal, modul kampaní v repozitáři ještě
 * nebyl a přímý import neexistující podcesty by shodil celou doménu kontaktů už při
 * načtení, takže by nešlo odhlásit vůbec nikoho. Kampaně už tu dávno jsou, ale port
 * zůstává, protože obrácená vazba (kontakty → kampaně staticky) je cyklus: kampaně
 * z kontaktů importují katalog polí i počty členů seznamu.
 *
 * ZDE BYLA VADA. Tělo bylo `if (implementation === null) return { revoked: 0 }`
 * a `registerRevokePendingMessages` NEVOLAL NIKDO než testy. Odhlášení z odběru, výmaz
 * podle článku 17, zápis na blokované adresy i omezení zpracování tedy dostávaly
 * „zrušeno nula" a připravená zpráva odešla i člověku, který se právě odhlásil.
 * Tiše: bez chyby, bez záznamu, bez stopy.
 *
 * OPRAVA NENÍ „někdo to zaregistruje při startu". Ten tvar tady prokazatelně selhává:
 * registrace z `apps/web/src/instrumentation.ts` je pro obsluhu trasy neviditelná,
 * protože běží v jiném modulovém grafu a `implementation` je tam jiná proměnná. A vede
 * to přes trasu, `/u/[token]`. Port si proto implementaci dohledá SÁM při prvním
 * volání, uvnitř téhož grafu, ze kterého se volá. Import je dynamický jen kvůli tomu
 * cyklu; jinak by mohl být obyčejný.
 *
 * Tvar vstupu je NORMATIVNÍ a je převzatý z plánu doslova, protože na něm stojí
 * kritérium 79: `listId` se předává vždy, i když je `null`.
 */
import type { Tx } from '../tx';
/**
 * Důvody zrušení čekajících zpráv. Řetězce jsou převzaté z plánu doslova a NESLUČUJÍ SE:
 * článek 17 (contact_anonymized) a článek 18 (processing_restricted) jsou dva různé
 * právní důvody s různou vratností a report kampaně je musí umět odlišit.
 */
export type RevokeReason =
  'unsubscribed' | 'suppressed' | 'contact_anonymized' | 'processing_restricted';

export type RevokePendingMessagesInput = {
  workspaceId: string;
  contactIds: string[];
  /** Rozsah. `null` znamená všechny čekající zprávy kontaktu. Klíč nikdy nechybí. */
  listId: string | null;
  reason: RevokeReason;
  /**
   * Transakce volajícího. Předává se VŽDY, když je po ruce, a po ruce je na všech
   * čtyřech produkčních cestách, protože všechny běží uvnitř `withWorkspace`.
   *
   * Bez ní si zrušení otevře vlastní spojení a vlastní transakci, a tím vzniknou dva
   * nezávislé commity: vnější transakce se může rollbacknout poté, co zrušení už
   * proběhlo, nebo naopak. Komentář u odhlášení slibuje „ve STEJNÉ transakci" a tohle
   * je to, čím se ten slib plní.
   */
  tx?: Tx | undefined;
};

export type RevokePendingMessagesFn = (
  input: RevokePendingMessagesInput,
) => Promise<{ revoked: number }>;

let implementation: RevokePendingMessagesFn | null = null;

/** Registruje P13 při startu procesu. Druhá registrace přepíše první. */
export function registerRevokePendingMessages(fn: RevokePendingMessagesFn): void {
  implementation = fn;
}

/**
 * Jen pro testy: zahodí registrovanou implementaci. Port tím NEPŘESTANE fungovat,
 * vrátí se k té z domény kampaní, protože „nedělá nic" není stav, do kterého by
 * tenhle port směl spadnout.
 */
export function resetRevokePendingMessages(): void {
  implementation = null;
}

export async function revokePendingMessages(
  input: RevokePendingMessagesInput,
): Promise<{ revoked: number }> {
  if (implementation !== null) return implementation(input);
  const { revokePendingMessagesFromContacts } = await import('../campaigns/outbox/contacts-port');
  return revokePendingMessagesFromContacts(input);
}
