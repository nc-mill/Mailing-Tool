import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import {
  JOB_STATUSES,
  RUNNING_JOB_STATUSES,
  cancelJob,
  countJobs,
  getJob,
  listJobs,
  runningJobCount,
  type JobRecord,
} from '../jobs/registry';
import { installJobSources } from '../jobs/built-in-sources';
import { readWorkerStatus } from '../jobs/worker-status';

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
    /** Smí se úloha zastavit teď? Obrazovka podle toho tlačítko ukáže, nebo neukáže. */
    can_cancel: z.boolean(),
    /** Zrušení je vyžádané, běh dobíhá rozpracovanou dávku. Není to `cancelled`. */
    stopping: z.boolean(),
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
        /**
         * Kurzor na další stránku: vrať jen úlohy změněné DŘÍV než tenhle
         * okamžik. Hodnota se opisuje z `next_before` předchozí odpovědi,
         * neskládá se na klientu.
         */
        before: z.string().datetime().optional(),
      })
      .strict(),
  },
  responses: {
    200: {
      description: 'Seznam úloh, nejnovější změna první',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(JobSchema),
            running_count: z.number().int(),
            /**
             * Kolik úloh má projekt celkem, přes všechny zdroje. Stránkovací
             * patička tabulky bez toho píše „50 z 50", tedy tvrdí, že za
             * koncem stránky nic není, přesně ve chvíli, kdy vedle svítí
             * šipka na další stránku.
             */
            total: z.number().int(),
            /**
             * Kurzor na další stránku, nebo `null`, když další už není.
             * Klient podle NĚJ, ne podle počtu vrácených řádků, rozhoduje,
             * jestli nabídne „načíst další".
             */
            next_before: z.string().nullable(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const WorkerStatusSchema = z
  .object({
    /**
     * `unknown` NENÍ `down`. `down` je naměřené ticho, `unknown` znamená, že
     * se nedalo změřit nic (chybějící schéma fronty, nedostupná databáze).
     */
    state: z.enum(['running', 'late', 'down', 'unknown']),
    last_seen_at: z.string().nullable(),
    seconds_since_last_seen: z.number().int().nullable(),
    queue: z.object({
      waiting: z.number().int(),
      running: z.number().int(),
      /**
       * Selhání ZA OKNO, ne za celou historii. Celkové číslo bez časového
       * rámce je poplašná zpráva: 7. 8. stálo na panelu 4 142, z toho 4 116
       * byla jedna fronta padající od 3. srpna, která se mezitím spravila.
       */
      failed_recent: z.number().int(),
      failed_window_hours: z.number().int(),
      /** Úlohy v dead letter frontách. Ty nikdo nezpracuje, čekají na člověka. */
      dead_letter: z.number().int(),
    }),
    queues: z.object({
      registered: z.number().int(),
      cron_expected: z.number().int(),
      cron_scheduled: z.number().int(),
    }),
  })
  .openapi('WorkerStatus');

/**
 * STAV ZPRACOVÁNÍ NA POZADÍ, tedy „běží worker, nebo to někde visí".
 *
 * PROČ VLASTNÍ CESTA, A NE POLE V ODPOVĚDI SEZNAMU. Kvůli obnovování, a je to
 * to podstatné rozhodnutí. Seznam úloh se obnovuje JEN DOKUD NĚCO BĚŽÍ
 * (zdůvodnění v `apps/web/src/features/jobs/refresh.ts`), což je u seznamu
 * správně a u stavu workeru přesně naopak: worker, který se zasekl, se pozná
 * v okamžiku, kdy neběží nic. Přibalený do seznamu by se tedy přestal
 * aktualizovat ve chvíli, kdy je nejvíc potřeba.
 *
 * TENHLE ÚDAJ JE CELOINSTALAČNÍ, NE PROJEKTOVÝ, a nese to jen souhrnná čísla.
 * Fronta pg-bossu žádný `workspace_id` nemá, takže se z ní po projektech ani
 * číst nedá. Ven proto jdou POUZE součty: žádné názvy front, žádné nákladové
 * údaje, žádná jednotlivá úloha. Majitel projektu se z toho dozví, jestli má
 * čekat, nebo volat správce, a nic o práci cizích projektů.
 */
const workerRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/jobs/worker',
  tags: ['Jobs'],
  summary: 'Stav workeru a fronty na pozadí',
  security: [{ bearerAuth: ['timeline:read'] }],
  responses: {
    200: {
      description: 'Souhrnný stav zpracování na pozadí',
      content: { 'application/json': { schema: z.object({ worker: WorkerStatusSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
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
 * ZRUŠENÍ JE SPOLEČNÉ PRO CELÉ CENTRUM ÚLOH, ne u každé domény zvlášť.
 *
 * Doménové cesty existují dál a nikam nemizí (`/contacts/imports/{id}/cancel`,
 * `/campaigns/{id}/cancel`); tahle je nevolá místo nich, ale skrze ně. Důvod je
 * jediný: Centrum úloh zná o úloze jenom dvojici `kind` + `id`. Kdyby si mělo
 * vybírat doménovou cestu samo, muselo by znát i doménové oprávnění, tvar těla
 * a významy chyb každé z nich, a každý nový zdroj úloh by znamenal zásah do
 * obrazovky. Takhle stačí, aby si zdroj u sebe zaregistroval `cancel`.
 *
 * `202` by tu bylo přesnější než `200` (běh se opravdu zastaví až u nejbližší
 * kontroly), ale odpověď nese ÚLOHU PO ZÁSAHU a `outcome`, tedy hotový stav,
 * ne příslib. Rozdíl mezi „ruší se" a „už bylo zrušené" říká `outcome`, ne kód.
 */
const cancelRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/jobs/{kind}/{id}/cancel',
  tags: ['Jobs'],
  summary: 'Zastavení běžící úlohy',
  // Oprávnění závisí na druhu úlohy (`contacts:import`, `campaigns:control`),
  // takže ho tady vyjmenovat nejde. Ověřuje ho zdroj přes `cancelJob`.
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict() },
  responses: {
    200: {
      description: 'Zrušení přijato, nebo úloha už byla v koncovém stavu',
      content: {
        'application/json': {
          schema: z.object({
            outcome: z.enum(['cancelling', 'already_cancelled', 'already_finished']),
            job: JobSchema,
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
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
  /**
   * ZDROJE ÚLOH SE ZAPOJUJÍ TADY, ne v `instrumentation.ts`.
   *
   * Bez tohohle řádku vracely obě cesty prázdno, protože `registerJobSource`
   * nikdo v produkčním kódu nevolal: nula výskytů, jediné volání bylo v testech.
   * Endpoint tedy hlásil `running_count: 0` i uprostřed běžícího importu.
   *
   * A schválně to není v `instrumentation.ts`, ačkoli tam podobná zapojení jsou:
   * Next.js ho vyhodnocuje v JINÉM MODULOVÉM GRAFU než obsluhu trasy, takže by
   * obsluha četla vlastní kopii modulu s prázdným registrem. Odsud je registrace
   * a obsluha tentýž modul, takže se rozejít nemůžou.
   */
  installJobSources();

  app.openapi(listRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const { limit, running, before } = c.req.valid('query');
    const jobs = await listJobs(ctx, { limit, ...(before === undefined ? {} : { before }) });
    /*
     * Filtr `running=true` znamená doslova BĚŽÍCÍ, tedy totéž co `running_count`
     * vedle něj. Dřív tu byla třetí opsaná kopie výčtu `['running','paused']`
     * a s ní rozpor: odpověď hlásila pozastavenou úlohu jako běžící, ačkoli
     * `built-in-sources.ts` ji jako `paused` označuje právě proto, aby se za
     * běžící nepovažovala. Výčet se proto čte z registru, ne odsud.
     */
    const filtered =
      running === 'true' ? jobs.filter((j) => RUNNING_JOB_STATUSES.includes(j.status)) : jobs;
    /*
     * Kurzor se počítá z NEFILTROVANÉHO seznamu, ne z toho, co se posílá ven.
     * Kdyby ho dodala poslední PROPUŠTĚNÁ úloha, přeskočila by další stránka
     * všechno, co filtr mezitím zahodil. Kurzor je pozice ve zdroji, ne
     * ve výsledku.
     *
     * A vzniká jen tehdy, když je stránka plná: kratší stránka znamená, že
     * zdroje došly, a tlačítko „načíst další" nad prázdnem je horší než žádné.
     */
    const last = jobs.at(-1);
    const nextBefore = jobs.length === limit && last ? last.updatedAt : null;
    return c.json(
      {
        data: filtered.map(toPublicJob),
        running_count: await runningJobCount(ctx),
        total: await countJobs(ctx),
        next_before: nextBefore,
      },
      200,
    );
  });

  app.openapi(workerRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const status = await readWorkerStatus();
    return c.json(
      {
        worker: {
          state: status.state,
          last_seen_at: status.lastSeenAt,
          seconds_since_last_seen: status.secondsSinceLastSeen,
          queue: {
            waiting: status.queue.waiting,
            running: status.queue.running,
            failed_recent: status.queue.failedRecently,
            failed_window_hours: status.queue.failedWindowHours,
            dead_letter: status.queue.deadLetter,
          },
          queues: {
            registered: status.queues.registered,
            cron_expected: status.queues.cronExpected,
            cron_scheduled: status.queues.cronScheduled,
          },
        },
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

  app.openapi(cancelRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    // `timeline:read` je vstupenka do Centra úloh, ne do zásahu. Doménové
    // oprávnění ověří `cancelJob` podle druhu úlohy, protože jen zdroj ví,
    // co se vlastně zastavuje.
    assertPermission(ctx, 'timeline:read');
    const { kind, id } = c.req.valid('param');
    const result = await cancelJob(ctx, kind, id, {
      assert: (permission) => assertPermission(ctx, permission),
    });
    if (result.status === 'not_found') throw new ApiError('not_found');
    if (result.status === 'unsupported') {
      // Zdroj, který zastavení neumí. Obrazovka u něj tlačítko nenabízí, takže
      // sem se dá dojít jen ručním voláním API; odpověď to má říct rovnou.
      throw new ApiError('conflict', { params: { code: 'job_not_cancellable', kind } });
    }
    return c.json({ outcome: result.outcome, job: toPublicJob(result.job) }, 200);
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
    can_cancel: job.cancellable,
    stopping: job.stopping,
  };
}
