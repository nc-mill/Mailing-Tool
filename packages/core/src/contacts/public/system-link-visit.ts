import { recordSystemLinkClick } from '../../tracking/system-links/record';
import type { SystemLinkKind } from '../../tracking/types';
import type { VerifiedPublicToken } from './unsubscribe';

/**
 * Připsání prokliku na systémový odkaz kampani, ze které přišel.
 *
 * Tenhle soubor je most, ne logika. Zápis vlastní `tracking/system-links`,
 * tady se jen z ověřeného veřejného tokenu vyzobou jeho složky. Volají to
 * stránky `/u/`, `/p/` a `/v/`, protože jsou to jediné odkazy v e-mailu, které
 * nevedou přes `/t/c/`, a bez tohohle volání se o nich měření nedozví nic.
 *
 * VOLÁ SE JEN Z GET, tedy z načtení stránky prohlížečem příjemce. One-click POST
 * podle RFC 8058 posílá infrastruktura poštovního poskytovatele, ne člověk;
 * připsat mu proklik by znamenalo měřit stroj. Odhlášení samo se z něj zapíše
 * dál, to dělá `unsubscribeByToken`.
 *
 * SELHÁNÍ SE POLKNE. Stránka odhlášení musí fungovat i tehdy, když je databáze
 * měření nedostupná: zákonná povinnost umožnit odhlášení nesmí viset na tom,
 * jestli se povede zapsat statistika.
 */
export async function recordSystemLinkVisit(
  token: VerifiedPublicToken,
  kind: SystemLinkKind,
): Promise<void> {
  try {
    await recordSystemLinkClick({
      workspaceId: token.data.workspaceId,
      messageId: token.data.messageId,
      messageCreatedAt: token.data.messageCreatedAt,
      contactId: token.data.contactId,
      kind,
    });
  } catch {
    // Záměrně bez opakování a bez chyby navenek, viz komentář výš.
  }
}
