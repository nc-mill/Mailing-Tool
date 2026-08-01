import { createSystemContext } from '../../identity/context';
import { fanoutEvent } from '../webhooks/emit';

export type FanoutJobData = { event_id: string; workspace_id: string };

/**
 * 9.1: každý pg-boss job musí být idempotentní, protože singletonKey
 * negarantuje, že job proběhne právě jednou. Fan-out je idempotentní přes
 * ON CONFLICT nad uq_webhook_deliveries__event_endpoint, viz emit.ts.
 *
 * ODCHYLKA OD PLÁNU: `createSystemContext` se doplnil do importů. Plán ho
 * v těle volal, ale neimportoval, takže by modul nešlo přeložit.
 */
export async function handler(job: { data: FanoutJobData }): Promise<void> {
  await fanoutEvent(
    createSystemContext(job.data.workspace_id, 'platform.webhook_fanout'),
    job.data.event_id,
  );
}
