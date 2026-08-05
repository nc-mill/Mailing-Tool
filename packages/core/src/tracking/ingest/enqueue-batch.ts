import { sql } from 'drizzle-orm';
import { withWorkspace, type WorkspaceContext } from '../../tx';
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
 * Kontext přijde od volajícího, ne ze session: povrch `/e/**` žádnou session
 * nemá a projekt zná z ověřeného veřejného klíče, ze kterého si `event-runtime`
 * vyrobí systémový kontext. Rozsah je proto vidět z podpisu a řetězcem se
 * podstrčit nedá.
 *
 * Neznámý projekt nebo poškozená větev vrací výchozí hodnoty, protože
 * vypadnout kvůli nastavení by znamenalo přestat měřit.
 */
export async function readTrackingSettings(ctx: WorkspaceContext): Promise<TrackingSettings> {
  const raw = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ tracking: unknown }>(sql`
        SELECT settings -> 'tracking' AS tracking FROM workspaces WHERE id = ${ctx.workspaceId}
      `);
    return rows[0]?.tracking ?? null;
  });

  if (raw === null || typeof raw !== 'object') return DEFAULT_TRACKING_SETTINGS;
  const parsed = TrackingSettingsSchema.safeParse({ ...DEFAULT_TRACKING_SETTINGS, ...raw });
  return parsed.success ? parsed.data : DEFAULT_TRACKING_SETTINGS;
}
