import { sql } from 'drizzle-orm';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { trackingLogger } from '../logging';
import { withTrackingTx } from '../repo/tx';

export const RECOMPUTE_ENGAGEMENT_WINDOWS_QUEUE = 'tracking.recompute_engagement_windows';

/**
 * Denní přepočet klouzavých oken zapojení (3.9.4 části 5).
 *
 * Okna `sent7d`…`clicks90d` jsou jediná část `contact_engagement`, kterou
 * PŘÍRŮSTKOVĚ udržovat nejde: čas plyne i tehdy, když se nic neděje, takže
 * kontakt, kterému se posledních deset dní nic neposlalo, musí mít `sent7d`
 * nulu, aniž by k němu dorazila jediná událost. Je to čistá funkce zdrojových
 * dat, proto se počítá celá znovu a proto na ní nezáleží, kolikrát doběhne.
 *
 * Zdrojem je `message_engagement`, tedy tatáž tabulka jako u
 * `recomputeContactEngagement`. Otevření a prokliky se počítají jen OVĚŘENÉ
 * (`first_human_*`), aby kampaň otevřená výhradně Apple proxy okno nezvedla.
 *
 * Řádky se jen AKTUALIZUJÍ, nezakládají: kontakt bez jediné zprávy řádek nemá
 * a nemá ho mít, viz líné zakládání v `contact-engagement.repo.ts`.
 */
/**
 * Projekt jako POJMENOVANÁ hodnota, ne holý řetězec. Pravidlo hlídá
 * `identity/scope.test.ts`: exportovaná funkce mimo `packages/core/src/tx`
 * nesmí brát `workspaceId: string` a podle něj sama sahat do databáze.
 */
export type EngagementWindowsScope = { workspaceId: string };

export async function recomputeWindowsForWorkspace(scope: EngagementWindowsScope): Promise<number> {
  const { workspaceId } = scope;
  return withTrackingTx({ workspaceId, job: RECOMPUTE_ENGAGEMENT_WINDOWS_QUEUE }, async (tx) => {
    const { rows } = await tx.execute<{ contact_id: string }>(sql`
        WITH windows AS (
          SELECT me.contact_id,
                 count(*) FILTER (WHERE me.created_at >= now() - interval '7 days')   AS sent7d,
                 count(*) FILTER (WHERE me.created_at >= now() - interval '30 days')  AS sent30d,
                 count(*) FILTER (WHERE me.created_at >= now() - interval '90 days')  AS sent90d,
                 count(*) FILTER (WHERE me.first_human_open_at >= now() - interval '7 days')   AS opens7d,
                 count(*) FILTER (WHERE me.first_human_open_at >= now() - interval '30 days')  AS opens30d,
                 count(*) FILTER (WHERE me.first_human_open_at >= now() - interval '90 days')  AS opens90d,
                 count(*) FILTER (WHERE me.first_human_click_at >= now() - interval '7 days')  AS clicks7d,
                 count(*) FILTER (WHERE me.first_human_click_at >= now() - interval '30 days') AS clicks30d,
                 count(*) FILTER (WHERE me.first_human_click_at >= now() - interval '90 days') AS clicks90d
            FROM message_engagement me
           WHERE me.workspace_id = ${workspaceId}::uuid
             AND me.contact_id IS NOT NULL
             AND me.created_at >= now() - interval '90 days'
           GROUP BY me.contact_id
        )
        UPDATE contact_engagement ce
           SET sent7d = w.sent7d, sent30d = w.sent30d, sent90d = w.sent90d,
               opens7d = w.opens7d, opens30d = w.opens30d, opens90d = w.opens90d,
               clicks7d = w.clicks7d, clicks30d = w.clicks30d, clicks90d = w.clicks90d,
               windows_recomputed_at = now(),
               updated_at = now()
          FROM windows w
         WHERE ce.workspace_id = ${workspaceId}::uuid
           AND ce.contact_id = w.contact_id
        RETURNING ce.contact_id
      `);
    return rows.length;
  });
}

/**
 * Obsluha cronové fronty. Dvoutaktní postup: sken projektů pod rolí
 * `mlain_maintenance`, práce pod `mlain_app` v kontextu jednoho projektu.
 */
export async function handleRecomputeEngagementWindows(): Promise<void> {
  const workspaceIds = await listWorkspaceIds();
  let total = 0;
  for (const workspaceId of workspaceIds) {
    total += await recomputeWindowsForWorkspace({ workspaceId });
  }
  trackingLogger().debug(
    { job: RECOMPUTE_ENGAGEMENT_WINDOWS_QUEUE, contacts: total },
    'klouzavá okna zapojení přepočtena',
  );
}
