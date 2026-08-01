import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { JOB_STATUSES, getJob, listJobs, runningJobCount, type JobRecord } from '../jobs/registry';

const JobSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    status: z.enum(JOB_STATUSES),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    started_by: z.string().nullable(),
    started_at: z.string(),
    updated_at: z.string(),
    finished_at: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi('Job');

/**
 * ODCHYLKA OD PLÁNU: obě cesty deklarují chybové odpovědi 401, 403 a 404.
 * Plán je u Centra úloh vynechal, jenže úkol 42 má test, který u KAŽDÉ operace
 * pod `/api/v1` žádá aspoň jednu chybovou odpověď se schématem Problem. Bez nich
 * by dokumentace tvrdila, že endpoint nikdy neselže, ačkoliv 401 vrací hned
 * první nepřihlášený požadavek.
 */
const listRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/jobs',
  tags: ['Jobs'],
  summary: 'Úlohy projektu pro Centrum úloh',
  security: [{ bearerAuth: ['timeline:read'] }],
  request: {
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        running: z.enum(['true', 'false']).optional(),
      })
      .strict(),
  },
  responses: {
    200: {
      description: 'Seznam úloh, nejnovější změna první',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(JobSchema), running_count: z.number().int() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const detailRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/jobs/{kind}/{id}',
  tags: ['Jobs'],
  summary: 'Detail jedné úlohy',
  security: [{ bearerAuth: ['timeline:read'] }],
  request: { params: z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict() },
  responses: {
    200: {
      description: 'Detail úlohy',
      content: { 'application/json': { schema: z.object({ job: JobSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Cesta nese `kind` v URL schválně. ID úloh pocházejí z různých doménových
 * tabulek a nejsou napříč nimi zaručeně jedinečná; bez druhu by se detail musel
 * ptát všech zdrojů a při shodě ID by vrátil cizí úlohu.
 *
 * `timeline:read` je nejnižší oprávnění, které má i viewer, a Centrum úloh je
 * čtení stavu vlastního projektu.
 */
export function registerJobRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const { limit, running } = c.req.valid('query');
    const jobs = await listJobs(ctx, { limit });
    const filtered =
      running === 'true'
        ? jobs.filter((j) => j.status === 'running' || j.status === 'paused')
        : jobs;
    return c.json(
      {
        data: filtered.map(toPublicJob),
        running_count: await runningJobCount(ctx),
      },
      200,
    );
  });

  app.openapi(detailRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const { kind, id } = c.req.valid('param');
    const job = await getJob(ctx, kind, id);
    // Neznámý druh i neznámé ID dávají shodně 404, aby z odpovědi nešlo
    // zjistit, které druhy úloh instalace zná.
    if (!job) throw new ApiError('not_found');
    return c.json({ job: toPublicJob(job) }, 200);
  });
}

function toPublicJob(job: JobRecord) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    done: job.done,
    total: job.total,
    started_by: job.startedBy,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
    note: job.note,
  };
}
