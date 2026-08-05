import type { QueueHandler } from '../../queues';
import { handler as purgeRenderData } from './purge_render_data';

/**
 * Rejstřík obsluh transakční pošty. Codegen workeru
 * (`apps/worker/codegen.mjs`) hledá právě tenhle soubor; bez něj by se fronta
 * zaregistrovala BEZ obsluhy, úloha by se zařadila, nikdo by si ji nevyzvedl
 * a nic by nespadlo. Přesně na tuhle vadu je pojistka
 * `apps/worker/test/handler-coverage.test.ts`.
 */

/** Úklidové joby payload nemají, běží jednou za dávku bez ohledu na její délku. */
function once(run: () => Promise<unknown>): QueueHandler {
  return async () => {
    await run();
  };
}

export const handlers: Record<string, QueueHandler> = {
  'transactional.purge_render_data': once(purgeRenderData),
};
