import type { QueueHandler } from '../../queues';
import { handler as cleanupAuditLog } from './cleanup_audit_log';
import { handler as cleanupIdempotency } from './cleanup_idempotency';
import { handler as cleanupSessions } from './cleanup_sessions';
import { handler as purgeWorkspaces } from './purge_workspaces';
import { handler as webhookDeliver, type DeliverJobData } from './webhook_deliver';
import { handler as webhookFanout, type FanoutJobData } from './webhook_fanout';

/**
 * ODCHYLKA OD PLÁNU, vynucená skutečným tvarem repozitáře.
 *
 * Rozhodnutí R3 plánu P04 slibovalo, že entrypoint workeru najde handler na
 * cestě `packages/core/src/<domena>/jobs/<akce>.ts`. Codegen workeru
 * (`apps/worker/codegen.mjs`, rozhodnutí D4 plánu P01) ale hledá JEDINÝ modul
 * `packages/core/src/<domena>/jobs/queue-handlers.ts` a čeká v něm export
 * `handlers`. Bez tohohle souboru by moduly akcí existovaly, testy by byly
 * zelené a worker by přesto nezpracoval ani jednu frontu platformy.
 *
 * Moduly akcí zůstávají jeden soubor na akci, jak chtěl P04. Tenhle modul je
 * jen jejich rejstřík a překlad z tvaru `QueueHandler` (dávka jobů) na tvar
 * jednoho jobu, se kterým pracují.
 */
function perJob<TData>(run: (job: { data: TData }) => Promise<unknown>): QueueHandler {
  return async (jobs) => {
    for (const job of jobs) {
      await run({ data: job.data as TData });
    }
  };
}

/** Úklidové joby payload nemají, běží jednou za dávku bez ohledu na její délku. */
function once(run: () => Promise<unknown>): QueueHandler {
  return async () => {
    await run();
  };
}

export const handlers: Record<string, QueueHandler> = {
  'platform.webhook_fanout': perJob<FanoutJobData>(webhookFanout),
  'platform.webhook_deliver': perJob<DeliverJobData>(webhookDeliver),
  'platform.cleanup_sessions': once(cleanupSessions),
  'platform.cleanup_idempotency': once(cleanupIdempotency),
  'platform.cleanup_audit_log': once(cleanupAuditLog),
  'platform.purge_workspaces': once(purgeWorkspaces),
};
