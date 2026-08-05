import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { readCampaignBuckets } from '../campaign-stats/buckets';
import { readCampaignLinks } from '../campaign-stats/links';
import { readCampaignStats } from '../campaign-stats/read';
import { readCampaignSystemLinkClicks } from '../campaign-stats/system-links';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { campaignStatsSchema, toStatsResponse, uuidParam } from './schemas';

export const campaignStatsRoutes = new OpenAPIHono<ReportsEnv>();

const statsRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stats',
  tags: ['reports'],
  summary: 'Souhrn kampaně',
  request: { params: uuidParam },
  responses: {
    200: {
      description: 'Souhrn',
      content: { 'application/json': { schema: campaignStatsSchema } },
    },
    304: { description: 'Beze změny' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

campaignStatsRoutes.openapi(statsRoute, async (c) => {
  const { id } = c.req.valid('param');
  assertPermission(workspaceOf(c), 'reports:read');
  const read = await inWorkspace(c, (tx, ctx) => readCampaignStats(tx, ctx, id));
  const etag = `W/"${read.version}"`;

  // Levné "beze změny" v režimu dotazování: odpověď 304 nemá tělo
  // a serverová práce je jedno čtení řádku podle primárního klíče.
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': 'no-store' });
  }

  c.header('ETag', etag);
  c.header('Cache-Control', 'no-store');
  return c.json(toStatsResponse(read), 200);
});

const timelineRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stats/timeline',
  tags: ['reports'],
  summary: 'Průběh kampaně v čase',
  request: {
    params: uuidParam,
    query: z.object({ granularity: z.enum(['5m', 'hour', 'day']).default('5m') }),
  },
  responses: {
    200: {
      description: 'Body grafu',
      content: {
        'application/json': {
          schema: z.object({
            granularity: z.enum(['5m', 'hour', 'day']),
            compacted: z.boolean(),
            points: z.array(
              z.object({
                at: z.string(),
                sent: z.number(),
                delivered: z.number(),
                opens_unique: z.number(),
                clicks_unique: z.number(),
                bounced: z.number(),
              }),
            ),
          }),
        },
      },
    },
    // Bez kontroly existence: neznámé campaignId dá prázdné body grafu, ne 404
    // (`readCampaignBuckets` filtruje jen podle `campaign_id` bez ověření).
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

campaignStatsRoutes.openapi(timelineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { granularity } = c.req.valid('query');
  assertPermission(workspaceOf(c), 'reports:read');
  const result = await inWorkspace(c, async (tx, ctx) => {
    // Zóna projektu, ne uživatele: report je vázaný k projektu (12.4 části 6).
    const { rows } = await tx.execute<{ timezone: string }>(
      sql`SELECT timezone FROM workspaces WHERE id = ${ctx.workspaceId}`,
    );
    return readCampaignBuckets(tx, ctx, {
      campaignId: id,
      granularity,
      timezone: rows[0]?.timezone ?? 'UTC',
    });
  });

  return c.json(
    {
      granularity: result.granularity,
      compacted: result.compacted,
      points: result.points.map((point) => ({
        at: point.at,
        sent: point.sent,
        delivered: point.delivered,
        opens_unique: point.opensUnique,
        clicks_unique: point.clicksUnique,
        bounced: point.bounced,
      })),
    },
    200,
  );
});

const linksRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/links',
  tags: ['reports'],
  summary: 'Na co lidé klikali',
  request: { params: uuidParam },
  responses: {
    200: {
      description: 'Odkazy kampaně',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                link_id: z.string(),
                url: z.string(),
                label: z.string().nullable(),
                position: z.number(),
                clicks_total: z.number(),
                clicks_unique: z.number(),
                clicks_human: z.number(),
                share: z.number(),
                duplicate_url: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    // Bez kontroly existence: neznámé campaignId dá prázdný seznam, ne 404
    // (`readCampaignLinks` filtruje jen podle `campaign_id` bez ověření).
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

campaignStatsRoutes.openapi(linksRoute, async (c) => {
  const { id } = c.req.valid('param');
  assertPermission(workspaceOf(c), 'reports:read');
  const links = await inWorkspace(c, (tx, ctx) => readCampaignLinks(tx, ctx, id));
  return c.json(
    {
      data: links.map((link) => ({
        link_id: link.linkId,
        url: link.url,
        label: link.label,
        position: link.position,
        clicks_total: link.clicksTotal,
        clicks_unique: link.clicksUnique,
        clicks_human: link.clicksHuman,
        share: link.share,
        duplicate_url: link.duplicateUrl,
      })),
    },
    200,
  );
});

/**
 * Prokliky na systémové odkazy v patičce: odhlášení, předvolby, webová verze.
 *
 * VLASTNÍ CESTA, NE POLE V `/stats`, a je to rozhodnuté schválně. Odpověď
 * `/stats` nese ETag odvozený z `campaign_stats.version`, jenže systémový
 * proklik se do `campaign_stats` záměrně neagreguje, takže by verzí nehnul:
 * klient s podmíněným dotazem by dostal 304 a nová čísla by neuviděl. Údaj,
 * který se mění nezávisle, patří za vlastní adresu.
 */
const systemLinkClicksRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/system-link-clicks',
  tags: ['reports'],
  summary: 'Kliknutí na odkazy v patičce',
  request: { params: uuidParam },
  responses: {
    200: {
      description: 'Počty po druzích odkazu. Do míry prokliku nevstupují a vstupovat nesmějí.',
      content: {
        'application/json': {
          schema: z.object({
            unsubscribe_page: z.number(),
            preferences: z.number(),
            webview: z.number(),
          }),
        },
      },
    },
    // Bez kontroly existence: neznámé campaignId dá samé nuly, ne 404, stejně
    // jako u seznamu odkazů výš.
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

campaignStatsRoutes.openapi(systemLinkClicksRoute, async (c) => {
  const { id } = c.req.valid('param');
  assertPermission(workspaceOf(c), 'reports:read');
  const counts = await inWorkspace(c, (tx, ctx) => readCampaignSystemLinkClicks(tx, ctx, id));
  c.header('Cache-Control', 'no-store');
  return c.json(counts, 200);
});
