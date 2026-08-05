import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { readCampaignWebActivity } from '../web-activity/campaign';
import { readWebActivityOverview, type WebOverviewPeriod } from '../web-activity/overview';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { uuidParam } from './schemas';

export const webActivityRoutes = new OpenAPIHono<ReportsEnv>();

const pageSchema = z.object({
  path: z.string(),
  views: z.number(),
  visitors: z.number(),
});

const eventSchema = z.object({
  name: z.string(),
  count: z.number(),
  visitors: z.number(),
});

const campaignWebActivitySchema = z.object({
  campaign_id: z.string(),
  started_at: z.string().nullable(),
  /** Za jak dlouho po prokliku se návštěva ještě připisuje kampani. */
  window_hours: z.number(),
  clicked_contacts: z.number(),
  visitor_contacts: z.number(),
  page_views: z.number(),
  other_events: z.number(),
  sessions: z.number(),
  last_visit_at: z.string().nullable(),
  pages: z.array(pageSchema),
  events: z.array(eventSchema),
  visitors: z.array(
    z.object({
      contact_id: z.string(),
      email: z.string(),
      name: z.string(),
      page_views: z.number(),
      events: z.number(),
      first_seen_at: z.string(),
      last_seen_at: z.string(),
    }),
  ),
});

const campaignRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/web-activity',
  tags: ['reports'],
  summary: 'Co příjemci kampaně dělali na webu',
  request: { params: uuidParam },
  responses: {
    200: {
      description: 'Webová aktivita připsaná kampani',
      content: { 'application/json': { schema: campaignWebActivitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

webActivityRoutes.openapi(campaignRoute, async (c) => {
  const { id } = c.req.valid('param');
  assertPermission(workspaceOf(c), 'reports:read');
  const result = await inWorkspace(c, (tx, ctx) => readCampaignWebActivity(tx, ctx, id));

  return c.json(
    {
      campaign_id: result.campaignId,
      started_at: result.startedAt,
      window_hours: result.windowHours,
      clicked_contacts: result.clickedContacts,
      visitor_contacts: result.visitorContacts,
      page_views: result.pageViews,
      other_events: result.otherEvents,
      sessions: result.sessions,
      last_visit_at: result.lastVisitAt,
      pages: result.pages,
      events: result.events,
      visitors: result.visitors.map((visitor) => ({
        contact_id: visitor.contactId,
        email: visitor.email,
        name: visitor.name,
        page_views: visitor.pageViews,
        events: visitor.events,
        first_seen_at: visitor.firstSeenAt,
        last_seen_at: visitor.lastSeenAt,
      })),
    },
    200,
  );
});

const overviewSchema = z.object({
  period_days: z.number(),
  computed_at: z.string(),
  known_contacts: z.number(),
  anonymous_visitors: z.number(),
  page_views: z.number(),
  other_events: z.number(),
  last_event_at: z.string().nullable(),
  pages: z.array(pageSchema),
  events: z.array(eventSchema),
  referrers: z.array(z.object({ host: z.string(), visits: z.number() })),
  visits: z.array(
    z.object({
      contact_id: z.string().nullable(),
      email: z.string().nullable(),
      name: z.string().nullable(),
      started_at: z.string(),
      ended_at: z.string(),
      page_views: z.number(),
      events: z.number(),
      entry_path: z.string().nullable(),
      last_path: z.string().nullable(),
      referrer_host: z.string().nullable(),
    }),
  ),
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/web-activity',
  tags: ['reports'],
  summary: 'Přehled aktivity na webu projektu',
  request: {
    query: z.object({
      period: z.coerce
        .number()
        .int()
        .refine((v) => [1, 7, 30].includes(v))
        .default(7),
    }),
  },
  responses: {
    200: {
      description: 'Aktivita na webu',
      content: { 'application/json': { schema: overviewSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

webActivityRoutes.openapi(overviewRoute, async (c) => {
  const { period } = c.req.valid('query');
  assertPermission(workspaceOf(c), 'reports:read');
  const result = await inWorkspace(c, (tx, ctx) =>
    readWebActivityOverview(tx, ctx, { periodDays: period as WebOverviewPeriod }),
  );

  return c.json(
    {
      period_days: result.periodDays,
      computed_at: result.computedAt,
      known_contacts: result.knownContacts,
      anonymous_visitors: result.anonymousVisitors,
      page_views: result.pageViews,
      other_events: result.otherEvents,
      last_event_at: result.lastEventAt,
      pages: result.pages,
      events: result.events,
      referrers: result.referrers,
      visits: result.visits.map((visit) => ({
        contact_id: visit.contactId,
        email: visit.email,
        name: visit.name,
        started_at: visit.startedAt,
        ended_at: visit.endedAt,
        page_views: visit.pageViews,
        events: visit.events,
        entry_path: visit.entryPath,
        last_path: visit.lastPath,
        referrer_host: visit.referrerHost,
      })),
    },
    200,
  );
});
