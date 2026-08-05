import { sql } from 'drizzle-orm';
import { enqueueTrackingJob } from '../jobs/enqueue';
import { withTrackingTx } from '../repo/tx';
import {
  DEFAULT_TRACKING_SETTINGS,
  TrackingSettingsSchema,
  type TrackingSettings,
} from '../settings';
import { EVENT_PROCESS_QUEUE } from './event-process';
import type { EventProcessPayload } from './ingest-service';

/**
 * Zařazení přijaté dávky do fronty `event.process`.
 *
 * Endpoint `/e/track` nemá s čím být atomický: nezapisuje nic doménového,
 * jen předává práci dál. Transakce je proto jednořádková a existuje jen proto,
 * že `enqueueTrackingJob` píše do tabulky pg-boss přímo, a to jde jedině
 * z transakce. Alternativou by bylo `boss.send()`, jenže spojení na pg-boss
 * v procesu webu není a otevírat ho kvůli jedné vložce by znamenalo druhý pool.
 */
export async function enqueueEventBatch(payload: EventProcessPayload): Promise<void> {
  await withTrackingTx({ workspaceId: payload.workspaceId, job: 'tracking.ingest' }, async (tx) => {
    await enqueueTrackingJob(
      tx,
      EVENT_PROCESS_QUEUE,
      payload as unknown as Record<string, unknown>,
    );
  });
}

/**
 * Trackingová větev `workspaces.settings`.
 *
 * Čte se napříč projekty přes kontext daného projektu, ne přes session:
 * povrch `/e/**` žádnou session nemá. Neznámý projekt nebo poškozená větev
 * vrací výchozí hodnoty, protože vypadnout kvůli nastavení by znamenalo
 * přestat měřit.
 */
export async function readTrackingSettings(workspaceId: string): Promise<TrackingSettings> {
  const raw = await withTrackingTx({ workspaceId, job: 'tracking.settings' }, async (tx) => {
    const { rows } = await tx.execute<{ tracking: unknown }>(sql`
        SELECT settings -> 'tracking' AS tracking FROM workspaces WHERE id = ${workspaceId}
      `);
    return rows[0]?.tracking ?? null;
  });

  if (raw === null || typeof raw !== 'object') return DEFAULT_TRACKING_SETTINGS;
  const parsed = TrackingSettingsSchema.safeParse({ ...DEFAULT_TRACKING_SETTINGS, ...raw });
  return parsed.success ? parsed.data : DEFAULT_TRACKING_SETTINGS;
}
