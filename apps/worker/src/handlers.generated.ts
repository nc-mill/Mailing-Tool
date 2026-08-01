// GENEROVANÝ SOUBOR. Nezapisuj do něj ručně, soubor se nikdy neslučuje ručně.
// Vyrábí ho apps/worker/codegen.mjs z modulů packages/core/src/<domena>/jobs/queue-handlers.ts.
// Při konfliktu v gitu zahoď obě verze a spusť: pnpm --filter @mlain/worker run codegen
import type { QueueHandler } from '@mlain/core/queues';
import { handlers as h0 } from '@mlain/core/platform/jobs';

export const HANDLERS: Record<string, QueueHandler> = {
  ...h0,
};
