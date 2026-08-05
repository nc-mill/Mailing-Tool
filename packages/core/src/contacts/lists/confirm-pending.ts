import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { contactExistsForJoinSql } from '../existence';
import { recordConsent } from '../repo/consents';
import { byId as listById } from '../repo/lists';
import { suppressedExistsSql } from '../suppression/predicate';

/**
 * HROMADNÉ POTVRZENÍ ČEKAJÍCÍCH PŘIHLÁŠENÍ JEDNOHO SEZNAMU.
 *
 * PROČ TO EXISTUJE. Přihlášení na seznamu s dvoufázovým potvrzením vzniká jako `pending`
 * a čeká, až příjemce klikne v potvrzovacím e-mailu. Dokud se potvrzovací e-maily
 * neposílají, není to čekání, ale slepá ulička: publikum kampaně bere jen potvrzené,
 * takže seznam se třemi lidmi vyjde jako nula a rozhraním se z toho nedá dostat.
 * Tohle je ta cesta ven a je to VÝSLOVNÉ ROZHODNUTÍ SPRÁVCE, ne automatika.
 *
 * VZOR JE `repo/contact-confirm.ts` A DRŽÍ SE ZÁMĚRNĚ: tentýž zápis souhlasu se zdrojem
 * `admin`, tatáž evidence s příznakem `declaration`, tatáž auditní akce
 * `subscription.forced_confirmed` po položkách. Rozdíl je jen v rozsahu: tam jeden
 * kontakt a všechny jeho seznamy, tady jeden seznam a jeho čekající.
 *
 * CO SE VĚDOMĚ NEPOTVRZUJE, protože to není čekání na potvrzení, ale ochrana příjemce:
 *   - odhlášení, odražení a stěžující si (stav přihlášení ani není `pending`),
 *   - kontakt, jehož vlastní stav je zamčený (`unsubscribed`, `bounced`, `complained`);
 *     globální odhlášení se do stavu konkrétního seznamu promítnout nemuselo,
 *   - adresa s živou blokací; ta se odblokovává jinou pravomocí a jinou cestou,
 *   - smazaný kontakt, kterému přihlášení zůstalo kvůli obnově.
 * Vynechané se počítají a vracejí, ne zamlčují: uživatel musí poznat rozdíl mezi
 * „potvrdilo se to všem" a „třem se to potvrdit nesmělo".
 */

export type ConfirmPendingResult = {
  /** Kolik přihlášení bylo ve stavu `pending` před zásahem. */
  pending: number;
  /** Kolik se jich potvrdilo. */
  confirmed: number;
  /** Kolik se jich vynechalo kvůli ochraně příjemce. */
  skipped: number;
};

/** Stav kontaktu, ze kterého tahle cesta nepovyšuje. Odpovídá `LOCKED_STATUSES` u ručního potvrzení. */
const LOCKED_CONTACT_STATUSES = "('unsubscribed', 'bounced', 'complained')";

/** Doklad zapisovaný do souhlasu. Tvar je shodný s ručním potvrzením kontaktu. */
const DECLARATION_EVIDENCE = { declaration: true, method: 'list_confirm_pending' } as const;

export async function confirmPendingSubscriptions(
  ctx: WorkspaceContext,
  listId: string,
): Promise<ConfirmPendingResult> {
  assertPermission(ctx, 'lists:write');

  // Archivovaný seznam se potvrzovat nedá: přihlašovat do zrušeného seznamu nedává smysl
  // a `byId` bez `includeArchived` ho nevrátí.
  if ((await listById(ctx, listId)) === null) throw new ApiError('not_found');

  return withWorkspace(ctx, async (tx) => {
    /*
     * Jeden dotaz, který vybere a ZAMKNE čekající řádky. Bez zámku by dvě souběžná
     * potvrzení obě přečetla týž stav a obě zapsala souhlas, takže by v append-only logu
     * byly dva doklady o jednom rozhodnutí.
     *
     * Ochranné podmínky se vyhodnocují TADY, ne až v UPDATE: potřebuje se rozdíl mezi
     * „čekalo" a „potvrdilo se", aby šlo vrátit počet vynechaných.
     */
    const waiting = await tx.execute<{ contact_id: string; eligible: boolean }>(sql`
      SELECT s.contact_id,
             (c.status NOT IN ${sql.raw(LOCKED_CONTACT_STATUSES)}
              AND NOT ${sql.raw(suppressedExistsSql('c'))}) AS eligible
        FROM list_subscriptions s
        JOIN contacts c ON c.id = s.contact_id AND c.workspace_id = s.workspace_id
       WHERE s.workspace_id = ${ctx.workspaceId}::uuid
         AND s.list_id = ${listId}::uuid
         AND s.status = 'pending'
         AND ${sql.raw(contactExistsForJoinSql('s'))}
       ORDER BY s.contact_id
         FOR UPDATE OF s
    `);

    const eligible = waiting.rows.filter((row) => row.eligible).map((row) => row.contact_id);
    const result: ConfirmPendingResult = {
      pending: waiting.rows.length,
      confirmed: 0,
      skipped: waiting.rows.length - eligible.length,
    };
    if (eligible.length === 0) return result;

    /*
     * `snooze_until` se nuluje ze stejného důvodu jako u ručního potvrzení: jinak by
     * zbyla čtvrtá tichá brána vedle stavu, seznamu a blokace. `unsubscribed_at` se
     * nechává, je to doklad.
     */
    const updated = await tx.execute<{ contact_id: string }>(sql`
      UPDATE list_subscriptions
         SET status = 'confirmed',
             confirmed_at = coalesce(confirmed_at, now()),
             snooze_until = NULL,
             updated_at = now()
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND list_id = ${listId}::uuid
         AND status = 'pending'
         AND contact_id = ANY(${sql.param(eligible)}::uuid[])
      RETURNING contact_id
    `);
    result.confirmed = updated.rows.length;

    /*
     * Kontakt se povyšuje jen z `unconfirmed`. Zamčené stavy sem nedojdou (odfiltrovala
     * je podmínka výš) a `active` nemá co měnit. Bez tohohle kroku by kampaň na CELÝ
     * projekt (bez seznamu) tyhle lidi minula, protože ta se ptá na `contacts.status`.
     */
    await tx.execute(sql`
      UPDATE contacts SET status = 'active', updated_at = now()
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND id = ANY(${sql.param(eligible)}::uuid[])
         AND status = 'unconfirmed'
    `);

    for (const row of updated.rows) {
      /*
       * Souhlas se váže NA SEZNAM, ne na celý projekt. Správce dokládá souhlas s tímhle
       * odběrem; rozšířit ho na všechny seznamy by znamenalo tvrdit víc, než tvrdil.
       * Ruční potvrzení kontaktu zapisuje projektový rozsah schválně, protože tam
       * správce potvrzuje člověka jako takového.
       */
      await recordConsent(ctx, {
        contactId: row.contact_id,
        purpose: 'email_marketing',
        status: 'granted',
        legalBasis: 'consent',
        scopeListId: listId,
        source: 'admin',
        evidence: DECLARATION_EVIDENCE,
        tx,
      });

      await writeAudit(tx, ctx, {
        action: 'subscription.forced_confirmed',
        targetType: 'list_subscription',
        targetId: listId,
        metadata: { contact_id: row.contact_id, source: 'list_confirm_pending' },
      });
    }

    await writeAudit(tx, ctx, {
      action: 'list.pending_confirmed',
      targetType: 'list',
      targetId: listId,
      metadata: { pending: result.pending, confirmed: result.confirmed, skipped: result.skipped },
    });

    return result;
  });
}
