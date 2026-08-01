import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { assertPermission } from '../../../identity/permissions';
import { problemResponse } from '../../../identity/api/schemas';
import { loadImport } from '../service';
import type { ImportsEnv } from './index';
import { Uuid } from './schemas';

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

/**
 * Průběh importu jako SSE.
 *
 * ODCHYLKA OD PLÁNU: plán četl `subscribeProgress()` z `progress.ts`, tedy
 * pub/sub uvnitř procesu. Import ale běží ve WORKERU, tedy v jiném procesu,
 * takže by web o postupu nic nevěděl. Zdrojem pravdy je proto `imports`,
 * kam worker zapisuje checkpoint v téže transakci jako dávku kontaktů.
 *
 * Interval je vteřina, ne rychleji. Číslo, které se mění desetkrát za sekundu,
 * je nečitelné a působí nervózně.
 */
const eventsRoute = createRoute({
  method: 'get',
  path: '/contacts/imports/{id}/events',
  tags: ['Imports'],
  summary: 'Průběh importu jako SSE',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Průběh importu jako SSE' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerImportEventRoutes(app: OpenAPIHono<ImportsEnv>): void {
  app.openapi(eventsRoute, (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const importId = c.req.valid('param').id;
    return streamSSE(c, async (stream) => {
      // Strop je dvě hodiny. Bez něj by zapomenutá karta držela spojení navždy.
      for (let tick = 0; tick < 7200; tick += 1) {
        const row = await loadImport(ctx, importId);
        const terminal = TERMINAL.has(row.status);
        await stream.writeSSE({
          event: 'progress',
          data: JSON.stringify({
            status: row.status,
            processed: Number(row.checkpoint_row),
            total: row.total_rows === null ? null : Number(row.total_rows),
            errors: Number(row.error_rows),
            terminal,
          }),
        });
        if (terminal) break;
        await stream.sleep(1000);
      }
    });
  });
}
