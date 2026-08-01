import { deliverWebhook } from '../webhooks/deliver';

export type DeliverJobData = { delivery_id: string; workspace_id: string; created_at: string };

/**
 * 3.8: retry řídíme sami přes next_attempt_at, ne přes pg-boss, protože
 * potřebujeme vlastní tabulku odstupů. Fronta má proto retryLimit 0.
 *
 * Doručení je nejméně jednou: při restartu workeru uprostřed HTTP requestu
 * nejde zjistit, jestli protistrana request přijala, takže se job zopakuje
 * a příjemce deduplikuje podle ML-Event-Id.
 */
export async function handler(job: { data: DeliverJobData }): Promise<void> {
  await deliverWebhook({
    deliveryId: job.data.delivery_id,
    workspaceId: job.data.workspace_id,
    createdAt: new Date(job.data.created_at),
  });
}
