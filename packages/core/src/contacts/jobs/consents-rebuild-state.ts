import { sql } from 'drizzle-orm';
import type { Tx } from '../../tx';
import { createSystemContext } from '../../identity/context';
import { withWorkspace } from '../../tx';

export type RebuildConsentStatePayload = { workspaceId: string };

/**
 * SAMOTNÝ PŘEPOČET, bez otevírání transakce. Transakci otevírá volající, a jsou
 * dva: obsluha fronty `consents.rebuild_state` přes `withWorkspace` (níž)
 * a příkaz `mlain rebuild-consents` přes `withAdminTx` (`ops/rebuild-consents.ts`).
 *
 * Rozdělené je to schválně, ne pro eleganci. Kdyby si příkaz napsal vlastní
 * příkaz, vznikly by DVĚ definice toho, co znamená „stav souhlasu", a rozešly
 * by se právě u obnovy ze zálohy, tedy v jediné chvíli, kdy na tom záleží.
 * Je to totéž rozhodnutí, jaké má `ops/rebuild-engagement.ts` u vzorce zapojení.
 *
 * Dotaz je omezený na `workspace_id` v `WHERE`, takže je správný i pod
 * migrátorskou rolí, na kterou se politiky RLS neuplatní.
 */
export async function rebuildConsentStateIn(
  tx: Tx,
  workspaceId: string,
): Promise<{ rebuilt: number }> {
  const result = await tx.execute<{ contact_id: string }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (contact_id, purpose)
             contact_id, workspace_id, purpose, status, legal_basis, occurred_at, id
        FROM consents
       WHERE workspace_id = ${workspaceId}::uuid
       ORDER BY contact_id, purpose, occurred_at DESC, id DESC
    )
    INSERT INTO contact_consent_state (contact_id, workspace_id, purpose, status,
                                       legal_basis, since, last_consent_id)
    SELECT contact_id, workspace_id, purpose, status, legal_basis, occurred_at, id FROM latest
    ON CONFLICT (contact_id, purpose) DO UPDATE SET
      status = excluded.status,
      legal_basis = excluded.legal_basis,
      since = excluded.since,
      last_consent_id = excluded.last_consent_id,
      updated_at = now()
    RETURNING contact_id
  `);
  return { rebuilt: result.rows.length };
}

/**
 * Přepočítá contact_consent_state z append-only logu. Používá se po obnově ze zálohy
 * a po migraci, kdy se stav mohl rozejít s logem.
 *
 * Idempotentní z definice: výsledek je funkce obsahu logu, takže druhý běh zapíše totéž.
 *
 * ODCHYLKA OD PLÁNU, TÁŽ JAKO U OSTATNÍCH JOBŮ. Plán bral `deps: { db: Database }`,
 * tedy handle bez kontextu projektu. Nad tabulkou s RLS by takový dotaz nevrátil nic
 * a job by tiše hlásil úspěch. Kontext se proto vyrábí z payloadu jedinou povolenou
 * továrnou `createSystemContext`.
 */
export async function rebuildConsentState(
  payload: RebuildConsentStatePayload,
): Promise<{ rebuilt: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'consents.rebuild_state');
  return withWorkspace(ctx, (tx) => rebuildConsentStateIn(tx, payload.workspaceId));
}
