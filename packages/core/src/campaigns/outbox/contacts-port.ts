import { createSystemContext } from '../../identity/context';
import type {
  RevokePendingMessagesFn,
  RevokePendingMessagesInput,
} from '../../contacts/campaigns-port';
import { registerRevokePendingMessages } from '../../contacts/campaigns-port';
import { revokePendingMessages } from './revoke';

/**
 * Adaptér, kterým doména kampaní plní port `revokePendingMessages` domény kontaktů.
 *
 * PROČ TO NEBYLO. Port měl od začátku tělo `if (implementation === null) return
 * { revoked: 0 }` a `registerRevokePendingMessages` NEVOLAL NIKDO než testy. Volají
 * ho přitom čtyři produkční cesty: odhlášení z odběru, výmaz podle článku 17, zápis
 * na blokované adresy a omezení zpracování. Všechny čtyři tedy dostávaly „zrušeno
 * nula" a čekající zpráva odešla i člověku, který se právě odhlásil. Bez chyby, bez
 * záznamu, bez stopy. Je to právní problém, ne kosmetika.
 *
 * PROČ TO NENÍ JEN `install...()` VOLANÝ Z KOMPOZIČNÍHO KOŘENE. Ten tvar tady selhává
 * a je to v projektu zapsaná past: registrace z `apps/web/src/instrumentation.ts` je
 * pro obsluhu trasy NEVIDITELNÁ, protože instrumentace běží v jiném modulovém grafu
 * a proměnná `implementation` v portu je tam jiná instance. Odhlášení přitom vede
 * právě přes trasu (`/u/[token]`), tedy přes tu polovinu, která by port neviděla,
 * a testy by byly zelené. Proto si port implementaci dohledá SÁM při prvním volání,
 * uvnitř téhož modulového grafu, ze kterého se volá. Zapomenout to nejde.
 *
 * `installRevokePendingMessages()` zůstává pro kompoziční kořeny, které chtějí mít
 * zapojení viditelné v logu při startu, a pro testy. Je idempotentní.
 */
export const revokePendingMessagesFromContacts: RevokePendingMessagesFn = async (
  input: RevokePendingMessagesInput,
) => {
  if (input.contactIds.length === 0) return { revoked: 0 };
  /**
   * Kontext je systémový schválně. Rušení čekající pošty je DŮSLEDEK operace, kterou
   * volající už provedl a na kterou svoje oprávnění měl; druhá kontrola oprávnění by
   * tady jen znamenala, že se odhlášení přes veřejný odkaz neprovede, protože ten
   * žádného přihlášeného aktéra nemá.
   *
   * Když volající předá svoji transakci, je `mlain.workspace_id` na tom spojení už
   * nastavené a kontext slouží jen jako zdroj `workspaceId` pro parametry dotazu.
   */
  const ctx = createSystemContext(input.workspaceId, 'contacts.revoke_pending');
  return revokePendingMessages(ctx, {
    contactIds: [...input.contactIds],
    listId: input.listId,
    reason: input.reason,
    tx: input.tx,
  });
};

/** Zapojení portu při startu procesu. Druhé volání jen přepíše tutéž funkci. */
export function installRevokePendingMessages(): void {
  registerRevokePendingMessages(revokePendingMessagesFromContacts);
}
