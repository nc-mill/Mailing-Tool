import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { recordConsent } from '../repo/consents';
import { addTagsToContact, ensureTags } from '../repo/tags';
import type { VerifiedPublicToken } from './unsubscribe';

/** Štítek je značka pro úklidový job P11: kontakty BEZ něj se po skončení okna zpracují. */
export const REACTIVATION_TAG = 'reaktivovan';

/**
 * Reaktivační kliknutí, tedy tlačítko „Ano, posílejte dál" v reaktivační kampani.
 *
 * Zapisuje souhlas se zdrojem `reactivation`. Ta hodnota MUSÍ být v CHECK omezení
 * `ck_consents__source`: dřív tam nebyla a první kliknutí by spadlo na 23514, takže
 * by reaktivační kampaň po prvním kliknutí přestala fungovat, a to bez varování.
 * Kryje to kritérium 83; že hodnota v omezení je, ověřuje databázový test.
 *
 * Zbytek reaktivačního scénáře (zmrazení segmentu, kampaň, úklidový job) vlastní plán
 * P11, protože stojí na segmentech. Sem patří jen zápis, který je čistě doménou souhlasů.
 *
 * Opakované kliknutí nic nezkazí: souhlas je append-only log (druhý řádek je pravda,
 * ne chyba), štítek se vkládá idempotentně a `last_activity_at` se jen posune.
 */
export async function applyReactivation(token: VerifiedPublicToken): Promise<void> {
  const ctx = token.scope.ctx;
  const contactId = token.data.contactId;

  const tagIds = await ensureTags(ctx, [REACTIVATION_TAG]);

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE contacts SET last_activity_at = now(), updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);

    await recordConsent(ctx, {
      contactId,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'reactivation',
      tx,
    });
  });

  await addTagsToContact(ctx, contactId, tagIds);
}
