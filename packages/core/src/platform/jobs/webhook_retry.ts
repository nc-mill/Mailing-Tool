import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import { createSystemContext } from '../../identity/context';
import { enqueueJob } from '../../queues/enqueue-sql';
import { withWorkspace } from '../../tx';
import { listWorkspaceIds } from '../maintenance-scan';

export const RETRY_JOB = 'platform.webhook_retry';

/**
 * Kolik doručení se z jednoho projektu zařadí za jeden tik.
 *
 * Strop tu je proto, že sken běží každou minutu nad všemi projekty. Bez něj by
 * jeden projekt s deseti tisíci čekajícími doručeními (typicky po výpadku
 * příjemce) zabral celý tik a na ostatní by nedošlo. Zbytek se zařadí příští
 * minutu, protože `next_attempt_at` v řádku zůstává.
 */
export const RETRY_BATCH_PER_WORKSPACE = 500;

/**
 * OPAKOVACÍ SKEN ODCHOZÍCH WEBHOOKŮ.
 *
 * PROČ TO NEDĚLÁ pg-boss. Fronta `platform.webhook_deliver` má `retryLimit: 0`
 * schválně: odstupy mezi pokusy předepisuje kontrakt vlastní tabulkou
 * (`webhooks/backoff.ts`, osm stupňů od 0 do 12 hodin s jitterem) a pg-boss
 * takový rozvrh neumí. Pokus číslo dva tedy musí zařadit aplikace, a tohle je
 * to jediné místo, kde se to děje.
 *
 * TŘI DRUHY ŘÁDKŮ, KTERÉ SKEN VYZVEDNE, a všechny tři dnes zůstávaly ležet:
 *
 *  1. `failed` s vyplněným `next_attempt_at`, tedy naplánovaný další pokus.
 *  2. `pending` po ručním opakování z obrazovky. `retryDelivery` v
 *     `delivery-query.ts` vrátí řádek na `pending` s `next_attempt_at = now()`
 *     a tím jeho práce končí; bez skenu se tlačítko „zkusit znovu" tvářilo,
 *     že něco udělalo.
 *  3. `pending` z fan-outu, kterému se zařazení nepovedlo (třeba proto, že
 *     doména běžela ve chvíli, kdy byla tabulka úloh nedostupná). Je to
 *     záchranná síť pod přímým zařazením v `emit.ts`, ne jeho náhrada.
 *
 * VYPNUTÝ ENDPOINT SE PŘESKAKUJE. Kontrakt 3.8 endpoint po dvaceti neúspěších
 * vypne právě proto, aby se na něj přestalo doručovat. Kdyby sken četl jen
 * `webhook_deliveries`, vypínání by nemělo žádný účinek: čekající doručení mají
 * `next_attempt_at` dávno spočítaný a sken by je zařazoval dál.
 *
 * IZOLACE PROJEKTŮ. Napříč projekty se odsud čte JEN seznam ID projektů, a to
 * přes `listWorkspaceIds()`, tedy jedinou povolenou cestou (`maintenance-scan.ts`).
 * Vlastní doručení se čtou už pod systémovým kontextem toho kterého projektu,
 * takže na ně RLS dopadá stejně jako na požadavek z API. Role `mlain_maintenance`
 * má granty jen na tři tabulky a `webhook_deliveries` mezi nimi nejsou, takže
 * jiná cesta ani neexistuje.
 */
export async function scanDueDeliveries(): Promise<{ scanned: number; enqueued: number }> {
  const schema = loadConfig().PGBOSS_SCHEMA;
  const workspaceIds = await listWorkspaceIds();
  let enqueued = 0;

  for (const workspaceId of workspaceIds) {
    const ctx = createSystemContext(workspaceId, RETRY_JOB);
    enqueued += await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string; created_at: Date }>(sql`
        SELECT d.id::text AS id, d.created_at
          FROM webhook_deliveries d
          JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE d.workspace_id = ${workspaceId}::uuid
           AND d.status IN ('pending', 'failed')
           AND d.next_attempt_at IS NOT NULL
           AND d.next_attempt_at <= now()
           AND e.status = 'active'
           AND e.deleted_at IS NULL
         ORDER BY d.next_attempt_at ASC
         LIMIT ${RETRY_BATCH_PER_WORKSPACE}
      `);

      let count = 0;
      for (const row of rows) {
        // `drop`, ne `fail`: doručení, které už ve frontě leží, je běžný stav.
        // Zařadil ho buď fan-out před vteřinou, nebo minulý tik tohohle skenu.
        // Zahození je tedy správný výsledek, ne ztráta práce.
        const ok = await enqueueJob(tx, {
          schema,
          name: 'platform.webhook_deliver',
          payload: {
            delivery_id: row.id,
            workspace_id: workspaceId,
            created_at: new Date(row.created_at).toISOString(),
          },
          singletonKey: `delivery:${row.id}`,
          onMerged: 'drop',
        });
        if (ok) count += 1;
      }
      return count;
    });
  }

  return { scanned: workspaceIds.length, enqueued };
}

export async function handler(): Promise<void> {
  await scanDueDeliveries();
}
