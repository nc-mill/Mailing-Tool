// GENEROVANÝ SOUBOR. Nezapisuj do něj ručně, soubor se nikdy neslučuje ručně.
// Vyrábí ho apps/worker/codegen.mjs z modulů packages/core/src/<domena>/jobs/queue-handlers.ts.
// Při konfliktu v gitu zahoď obě verze a spusť: pnpm --filter @mlain/worker run codegen
import type { QueueHandler } from '@mlain/core/queues';
import { handlers as h0 } from '@mlain/core/ai/jobs';
import { handlers as h1 } from '@mlain/core/campaigns/jobs';
import { handlers as h2 } from '@mlain/core/contacts/export/jobs';
import { handlers as h3 } from '@mlain/core/contacts/import/jobs';
import { handlers as h4 } from '@mlain/core/content/jobs';
import { handlers as h5 } from '@mlain/core/platform/jobs';
import { handlers as h6 } from '@mlain/core/segments/jobs';

export const HANDLERS: Record<string, QueueHandler> = {
  ...h0,
  ...h1,
  ...h2,
  ...h3,
  ...h4,
  ...h5,
  ...h6,
};
