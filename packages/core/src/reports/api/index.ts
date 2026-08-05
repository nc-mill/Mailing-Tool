import { OpenAPIHono } from '@hono/zod-openapi';
import type { ApiEnv } from '../../identity/api/schemas';
import type { ReportsEnv } from './context';

export type { ReportsEnv, ReportsVariables } from './context';

/**
 * Router celé domény. Mountuje ho `apps/web/src/lib/api/openapi.ts` (výjimka 0.4).
 *
 * Vstupní bod je nutný: mapa `exports` balíčku `@mlain/core` má na konci
 * pravidlo, které podcestu mapuje na `index.ts` domény. Import na úroveň souboru,
 * například `@mlain/core/reports/api/campaign-stats.routes`, se nerozřeší.
 */
export const reportsApi = new OpenAPIHono<ReportsEnv>();

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerReportsRoutes`.
 * Kdyby se cesty registrovaly až tam, druhé volání `buildApp()` (generátor
 * OpenAPI, testy) by je do téhož routeru přidalo podruhé a dokument by měl
 * každou cestu dvakrát. Stejný tvar má `contactsApi` v P07.
 *
 * POŘADÍ JE VÝZNAMNÉ: `/campaigns/{id}/stats/timeline` a `/campaigns/{id}/stream`
 * jsou v témže souboru nebo za souhrnem, takže konflikt statického
 * a parametrického segmentu nevzniká.
 */
import { campaignRecipientsRoutes } from './campaign-recipients.routes';
import { campaignStatsRoutes } from './campaign-stats.routes';
import { campaignStreamRoutes } from './campaign-stream.routes';
import { contactTimelineRoutes } from './contact-timeline.routes';
import { dashboardRoutes } from './dashboard.routes';
import { sentContentRoutes } from './sent-content.routes';
import { webActivityRoutes } from './web-activity.routes';

reportsApi.route('/', campaignStatsRoutes);
reportsApi.route('/', campaignRecipientsRoutes);
reportsApi.route('/', campaignStreamRoutes);
reportsApi.route('/', contactTimelineRoutes);
reportsApi.route('/', dashboardRoutes);
reportsApi.route('/', sentContentRoutes);
reportsApi.route('/', webActivityRoutes);

/**
 * Registrace do hlavní aplikace. Stejný tvar jako `registerContactsRoutes`,
 * aby `buildApp()` skládal všechny domény jedním způsobem.
 */
export function registerReportsRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', reportsApi as unknown as OpenAPIHono<ApiEnv>);
}
