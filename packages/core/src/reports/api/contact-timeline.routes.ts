import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createTranslator } from 'next-intl';
import { loadMessages, type MessageTree } from '@mlain/i18n/load-messages';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { readContactTimeline } from '../timeline/query';
import type { TimelineFilter } from '../timeline/types';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { uuidParam } from './schemas';

export const contactTimelineRoutes = new OpenAPIHono<ReportsEnv>();

const SUPPORTED_LOCALES = ['cs', 'en'] as const;
const FILTERS = ['email', 'web', 'contact', 'consent'] as const;

/**
 * Katalog se čte z disku, takže se drží v paměti procesu. Bez toho by každá
 * stránka časové osy znovu načítala všechny namespace obou jazyků.
 */
const catalogs = new Map<'cs' | 'en', Promise<MessageTree>>();

function messagesFor(locale: 'cs' | 'en'): Promise<MessageTree> {
  const cached = catalogs.get(locale);
  if (cached) return cached;
  const loading = loadMessages(locale);
  catalogs.set(locale, loading);
  return loading;
}

const timelineRoute = createRoute({
  method: 'get',
  path: '/contacts/{id}/timeline',
  tags: ['reports'],
  summary: 'Sjednocená časová osa kontaktu',
  request: {
    params: uuidParam,
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      types: z.string().optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Stránka časové osy',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                occurred_at: z.string(),
                // Otevřené výčty. Klient MUSÍ neznámou hodnotu tolerovat.
                source: z.string(),
                type: z.string(),
                title: z.string(),
                detail: z.record(z.string(), z.unknown()).optional(),
                campaign: z.object({ id: z.string(), name: z.string() }).optional(),
                session_id: z.string().optional(),
                reliability: z.enum(['confirmed', 'machine']).optional(),
              }),
            ),
            // Rod kontaktu pro věty ze slotů. Klient kontakt sám nečte.
            // Výčet je stejný jako `contacts.gender` v P03, tedy s `unknown`.
            // Na `other`, které používá komponenta K8, ho převádí až UI.
            contact: z.object({ gender: z.enum(['female', 'male', 'unknown']) }),
            pagination: z.object({
              next_cursor: z.string().nullable(),
              prev_cursor: z.string().nullable(),
              has_more: z.boolean(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed', 'tracking_timeline_window_too_large'),
    504: problemResponse('dependency_timeout'),
  },
});

contactTimelineRoutes.openapi(timelineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const query = c.req.valid('query');
  assertPermission(workspaceOf(c), 'reports:read');
  const locale = negotiateLocale(c.req.header('Accept-Language'));

  // Věty se skládají na serveru, aby je nemusel implementovat každý klient API.
  const messages = await messagesFor(locale);
  const translator = createTranslator({ locale, messages });
  const translate = (key: string, values: Record<string, unknown>): string =>
    translator(`reports.${key}` as never, values as never) as unknown as string;

  const types = query.types
    ? query.types
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is TimelineFilter => (FILTERS as readonly string[]).includes(value))
    : undefined;

  const page = await inWorkspace(c, (tx, ctx) =>
    readContactTimeline(tx, ctx, {
      contactId: id,
      limit: query.limit,
      translate,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(types === undefined ? {} : { types }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
    }),
  );

  return c.json(
    {
      data: page.items,
      contact: { gender: page.gender },
      pagination: {
        next_cursor: page.nextCursor,
        prev_cursor: null,
        has_more: page.hasMore,
        limit: query.limit,
      },
    },
    200,
  );
});

function negotiateLocale(header: string | undefined): 'cs' | 'en' {
  const preferred = (header ?? '').split(',')[0]?.trim().slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(preferred ?? '')
    ? (preferred as 'cs' | 'en')
    : 'cs';
}
