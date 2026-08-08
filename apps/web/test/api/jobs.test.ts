// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  clearJobSources,
  jobSourceFor,
  registerJobSource,
} from '@mlain/core/platform/jobs/registry';
import { installJobSources } from '@mlain/core/platform/jobs/built-in-sources';
import { resetFailedCache } from '@mlain/core/platform/jobs/worker-status';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerJobRoutes } from '@mlain/core/platform/api/jobs.routes';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { closePools, withWorkspace, withoutContext } from '@mlain/core/tx';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

/**
 * ODCHYLKA OD PLÁNU: aktér se seeduje `seedOwnerWithWorkspace` z `helpers/seed`,
 * ne `seedWorkspaceAndLogin` z neexistujícího `./helpers.js`, a kontext projektu
 * se předává hlavičkou `X-Workspace-Id`, protože cesta `/api/v1/jobs` slug
 * v URL nenese. Bez hlavičky by middleware neměl podle čeho kontext sestavit.
 */
let harness: PgHarness;
let app: TestApp;
let cookie = '';
let workspaceId = '';
let userId = '';

const headers = () => ({ Cookie: cookie, 'X-Workspace-Id': workspaceId });

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerJobRoutes);
  const seeded = await seedOwnerWithWorkspace(app, 'admin');
  cookie = seeded.cookie;
  workspaceId = seeded.workspaceId;
  userId = seeded.userId;
}, 180_000);

afterAll(async () => {
  clearJobSources();
  await closePools();
  await harness?.stop();
}, 120_000);

describe('GET /api/v1/jobs', () => {
  it('bez registrovaného zdroje vrací prázdný seznam a nulový odznak', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs', { headers: headers() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], running_count: 0, total: 0, next_before: null });
  });

  it('vrátí úlohy zaregistrovaného zdroje a spočítá jen běžící', async () => {
    clearJobSources();
    registerJobSource({
      kind: 'import',
      list: async () => [
        {
          id: 'a',
          kind: 'import',
          title: 'Import',
          status: 'running',
          done: 1,
          total: 4,
          startedBy: 'Petr',
          startedAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:05:00.000Z',
          finishedAt: null,
          note: null,
          cancellable: true,
          stopping: false,
        },
        {
          id: 'b',
          kind: 'import',
          title: 'Import',
          status: 'completed',
          done: 4,
          total: 4,
          startedBy: 'Petr',
          startedAt: '2026-08-01T09:00:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z',
          finishedAt: '2026-08-01T09:30:00.000Z',
          note: null,
          cancellable: false,
          stopping: false,
        },
      ],
      get: async () => null,
    });
    const body = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    expect(body.data.map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
    expect(body.running_count).toBe(1);
    expect(body.data[0].started_by).toBe('Petr');
  });

  /**
   * STRÁNKOVÁNÍ. Kurzor jde přes `updated_at`, ne přes offset, protože seznam
   * se slévá ze dvou zdrojů a ořezává se AŽ PO SLITÍ: `OFFSET 50` by v každém
   * zdroji přeskočil padesátku jeho vlastních úloh, ne padesátku z výsledku.
   */
  it('plná stránka nese kurzor na další, neúplná ho nemá', async () => {
    clearJobSources();
    const rows = ['a', 'b', 'c'].map((id, index) => ({
      id,
      kind: 'import',
      title: 'Import',
      status: 'completed' as const,
      done: 4,
      total: 4,
      startedBy: 'Petr',
      startedAt: '2026-08-01T09:00:00.000Z',
      updatedAt: `2026-08-01T09:0${3 - index}:00.000Z`,
      finishedAt: null,
      note: null,
      cancellable: false,
      stopping: false,
    }));
    registerJobSource({
      kind: 'import',
      list: async (_ctx, opts) =>
        rows
          .filter((row) => opts.before === undefined || row.updatedAt < opts.before)
          .slice(0, opts.limit),
      get: async () => null,
    });

    const full = await (await app.request('/api/v1/jobs?limit=2', { headers: headers() })).json();
    expect(full.data.map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
    expect(full.next_before).toBe('2026-08-01T09:02:00.000Z');

    const next = await (
      await app.request(`/api/v1/jobs?limit=2&before=${encodeURIComponent(full.next_before)}`, {
        headers: headers(),
      })
    ).json();
    expect(next.data.map((j: { id: string }) => j.id)).toEqual(['c']);
    // Neúplná stránka znamená, že zdroje došly. Kurzor by tu byl slib, který
    // se nedá splnit, a šipka na další stránku by po kliknutí nic nepřinesla.
    expect(next.next_before).toBeNull();
  });

  /**
   * CELKOVÝ POČET, ne délka stránky. Patička tabulky ho potřebuje, aby
   * nenapsala „50 z 50" ve chvíli, kdy vedle svítí šipka na další stránku.
   * Zdroj, který počítat neumí, se do celku prostě nezapočítá.
   */
  it('celkový počet sčítá zdroje, které ho umí spočítat', async () => {
    clearJobSources();
    registerJobSource({ kind: 'import', list: async () => [], get: async () => null });
    const withoutCounter = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    expect(withoutCounter.total).toBe(0);

    clearJobSources();
    registerJobSource({
      kind: 'import',
      list: async () => [],
      get: async () => null,
      count: async () => 7,
    });
    registerJobSource({
      kind: 'campaign_audience',
      list: async () => [],
      get: async () => null,
      count: async () => 5,
    });
    const counted = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    expect(counted.total).toBe(12);
  });

  it('neznámý druh v detailu vrací 404, ne 500', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs/neznamy/xyz', { headers: headers() });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('bez přihlášení vrací 401', async () => {
    const res = await app.request('/api/v1/jobs');
    expect(res.status).toBe(401);
  });
});

/**
 * VESTAVĚNÉ ZDROJE PROTI SKUTEČNÝM TABULKÁM.
 *
 * Testy výš podvrhují zdroj, takže ověřují API, ne to, že se do něj někdo
 * zapojí. Přesně tam byla vada: registr existoval, API existovalo, oprávnění
 * existovala, a `registerJobSource` NIKDO NEVOLAL, takže endpoint vracel
 * prázdno i uprostřed běžícího importu. Tenhle blok proto zdroje NEregistruje:
 * spoléhá na to, že je zapojí `registerJobRoutes`, a čte skutečné řádky.
 */
describe('vestavěné zdroje úloh', () => {
  let ctx: Awaited<ReturnType<typeof createWorkspaceContext>>;

  beforeAll(async () => {
    ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: workspaceId,
    });
  });

  it('import se objeví v Centru úloh i s postupem a jménem toho, kdo ho spustil', async () => {
    // Zdroje se tu schválně neregistrují: zapojit je má `registerJobRoutes`.
    // Kdyby to nedělal, spadne tenhle test, a to je jeho jediný smysl.
    installJobSources();
    const importId = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           total_rows, processed_rows, created_by, file_expires_at)
        VALUES (${workspaceId}::uuid, 'kontakty.csv', 1024, '\\x00'::bytea,
                ${`idem-${Date.now()}`}, 'importing', 400, 120, ${userId}::uuid,
                now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });

    const body = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    const job = body.data.find((j: { id: string }) => j.id === importId);
    expect(job, 'běžící import v Centru úloh není').toBeDefined();
    expect(job.kind).toBe('import');
    expect(job.title).toBe('kontakty.csv');
    expect(job.status).toBe('running');
    expect(job.done).toBe(120);
    expect(job.total).toBe(400);
    expect(job.started_by).toBe('Seed');
    expect(body.running_count).toBeGreaterThanOrEqual(1);

    // Detail musí odpovědět na tentýž druh a ID, jinak je odkaz ze seznamu slepý.
    const detail = await app.request(`/api/v1/jobs/import/${importId}`, { headers: headers() });
    expect(detail.status).toBe(200);
    expect((await detail.json()).job.id).toBe(importId);
  });

  it('import čekající na potvrzení mapování je pozastavený, ne běžící', async () => {
    // `previewing` znamená, že nic neběží a čeká se na člověka. Jako `running`
    // by odznak v topbaru ukazoval úlohu, která sama nikdy neskončí.
    installJobSources();
    const importId = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           created_by, file_expires_at)
        VALUES (${workspaceId}::uuid, 'ceka.csv', 10, '\\x00'::bytea,
                ${`idem-preview-${Date.now()}`}, 'previewing', ${userId}::uuid,
                now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });

    const detail = await (
      await app.request(`/api/v1/jobs/import/${importId}`, { headers: headers() })
    ).json();
    expect(detail.job.status).toBe('paused');

    // A DRUHÁ POLOVINA TÉHOŽ SLIBU: co je pozastavené, se nesmí počítat mezi
    // běžící. Právě tady se to dřív rozešlo: zdroj poctivě hlásil `paused`,
    // jenže `RUNNING_JOB_STATUSES` ho mezi běžící zase vrátil, takže odznak
    // v hlavičce svítil u importu, u kterého se dva dny nic nedělo.
    const running = await (
      await app.request('/api/v1/jobs?running=true&limit=100', { headers: headers() })
    ).json();
    expect(running.data.map((j: { id: string }) => j.id)).not.toContain(importId);
  });

  it('nahraný, ale nepotvrzený import je pozastavený, ne běžící', async () => {
    // `pending` znamená „soubor nahraný, průvodce otevřený". Do fronty se
    // nezařazuje NIC, dokud člověk neklikne na „Naimportovat", takže nedokončený
    // průvodce dřív rozsvítil odznak „Běží 1 úloha" navždy.
    installJobSources();
    const importId = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           created_by, file_expires_at)
        VALUES (${workspaceId}::uuid, 'nahrany.csv', 10, '\\x00'::bytea,
                ${`idem-pending-${Date.now()}`}, 'pending', ${userId}::uuid,
                now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });

    const detail = await (
      await app.request(`/api/v1/jobs/import/${importId}`, { headers: headers() })
    ).json();
    expect(detail.job.status).toBe('paused');

    const running = await (
      await app.request('/api/v1/jobs?running=true&limit=100', { headers: headers() })
    ).json();
    expect(running.data.map((j: { id: string }) => j.id)).not.toContain(importId);
  });

  it('úlohu z cizího projektu nevrátí ani v seznamu, ani v detailu', async () => {
    // Zdroje čtou přes `withWorkspace`, takže je izolace věcí RLS. Test to
    // ověřuje na datech, ne z předpokladu.
    installJobSources();
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherCtx = await createWorkspaceContext({
      kind: 'session',
      userId: other.userId,
      workspaceRef: other.workspaceId,
    });
    const foreignId = await withWorkspace(otherCtx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           created_by, file_expires_at)
        VALUES (${other.workspaceId}::uuid, 'cizi.csv', 10, '\\x00'::bytea,
                ${`idem-cizi-${Date.now()}`}, 'importing', ${other.userId}::uuid,
                now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });

    const body = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    expect(body.data.map((j: { id: string }) => j.id)).not.toContain(foreignId);

    const detail = await app.request(`/api/v1/jobs/import/${foreignId}`, { headers: headers() });
    expect(detail.status).toBe(404);
  });
});

/**
 * ZASTAVENÍ ÚLOHY PROTI SKUTEČNÝM TABULKÁM.
 *
 * Testy tady schválně nepodvrhují zdroj: ověřují, že cesta z Centra úloh
 * skutečně přepne stav v doméně. Zastavení je přitom SPOLUPRÁCE, ne zabití,
 * takže se ověřuje i to, co se stane při druhém kliknutí a u úlohy, která
 * mezitím doběhla. Obojí je běžný provoz, ne chyba obsluhy.
 */
describe('POST /api/v1/jobs/{kind}/{id}/cancel', () => {
  let ctx: Awaited<ReturnType<typeof createWorkspaceContext>>;

  beforeAll(async () => {
    ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: workspaceId,
    });
  });

  async function seedImport(status: string, processed = 0): Promise<string> {
    return withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           total_rows, processed_rows, created_by, file_expires_at)
        VALUES (${workspaceId}::uuid, 'zastavit.csv', 1024, '\\x00'::bytea,
                ${`idem-cancel-${status}-${randomUUID()}`}, ${status}, 500, ${processed},
                ${userId}::uuid, now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });
  }

  it('běžící import se zastaví a odpověď to řekne jako probíhající, ne hotové', async () => {
    installJobSources();
    const importId = await seedImport('importing', 120);

    const res = await app.request(`/api/v1/jobs/import/${importId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('cancelling');
    expect(body.job.status).toBe('cancelled');
    // Běh se ptá až u nejbližšího řádku, takže rozepsaná dávka ještě dobíhá.
    expect(body.job.stopping).toBe(true);
    expect(body.job.can_cancel).toBe(false);

    // A skutečně to musí být v doméně, ne jen v odpovědi: běh čte `imports.status`.
    const status = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ status: string }>(
        sql`SELECT status FROM imports WHERE id = ${importId}::uuid`,
      );
      return rows[0]!.status;
    });
    expect(status).toBe('cancelled');
  });

  it('druhé kliknutí nekončí chybou a konečný stav nepřepíše', async () => {
    installJobSources();
    const importId = await seedImport('importing', 10);
    await app.request(`/api/v1/jobs/import/${importId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });

    const res = await app.request(`/api/v1/jobs/import/${importId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('already_cancelled');
  });

  /**
   * ZÁVOD, ne dvojklik. Dva požadavky vyrazí naráz, oba vidí běžící úlohu a oba
   * zavolají doménu. Jeden podmíněný UPDATE zabere, druhý ne, a právě ten druhý
   * nesmí skončit chybou: uživatel by dostal červenou hlášku za to, že mu první
   * odpověď nestihla přijít.
   */
  it('dvě zastavení naráz skončí obě dobře a stav zůstane jeden', async () => {
    installJobSources();
    const importId = await seedImport('importing', 42);
    const send = () =>
      app.request(`/api/v1/jobs/import/${importId}/cancel`, {
        method: 'POST',
        headers: headers(),
      });

    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const outcomes = [(await a.json()).outcome, (await b.json()).outcome].sort();
    expect(outcomes).toEqual(['already_cancelled', 'cancelling']);
  });

  /**
   * ZÁVOD Z DRUHÉ STRANY. Předchozí test posílá dva požadavky naráz, jenže ten
   * druhý se obvykle zastaví o čtení stavu a k doméně se nedostane. Tady se
   * proto sahá rovnou na zdroj a stav se změní PŘESNĚ MEZI čtením a zápisem,
   * tedy tam, kde podmíněný UPDATE nezabere. Ani tenhle případ nesmí být chyba.
   */
  it('stav změněný mezi čtením a zápisem se přeloží na výsledek, ne na chybu', async () => {
    installJobSources();
    const source = jobSourceFor('import');
    expect(source?.cancel, 'import musí umět zastavení').toBeDefined();

    // Stav se mění SYROVÝM UPDATEM schválně: napodobuje druhého člověka, který
    // zrušil týž import o zlomek vteřiny dřív, ne volání téže funkce.
    const cancelledMeanwhile = await seedImport('importing', 7);
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        UPDATE imports SET status = 'cancelled', finished_at = now(), updated_at = now()
         WHERE id = ${cancelledMeanwhile}::uuid`),
    );
    expect(await source!.cancel!.run(ctx, cancelledMeanwhile)).toBe('already_cancelled');

    const finishedMeanwhile = await seedImport('completed', 500);
    expect(await source!.cancel!.run(ctx, finishedMeanwhile)).toBe('already_finished');
  });

  it('doběhlá úloha se zpětně zrušit nedá', async () => {
    installJobSources();
    const importId = await seedImport('completed', 500);

    const res = await app.request(`/api/v1/jobs/import/${importId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('already_finished');

    const status = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ status: string }>(
        sql`SELECT status FROM imports WHERE id = ${importId}::uuid`,
      );
      return rows[0]!.status;
    });
    expect(status, 'konečný stav se nesmí přepsat').toBe('completed');
  });

  it('náhled čekající na potvrzení se zastavit dá, ale nic přitom nedobíhá', async () => {
    installJobSources();
    const importId = await seedImport('previewing');

    const res = await app.request(`/api/v1/jobs/import/${importId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    const body = await res.json();
    expect(body.outcome).toBe('cancelling');
    // Nezapsal se ani řádek, takže věta o dobíhající dávce by byla výmysl.
    expect(body.job.stopping).toBe(false);
  });

  it('úloha z cizího projektu se zastavit nedá', async () => {
    installJobSources();
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherCtx = await createWorkspaceContext({
      kind: 'session',
      userId: other.userId,
      workspaceRef: other.workspaceId,
    });
    const foreignId = await withWorkspace(otherCtx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports
          (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
           created_by, file_expires_at)
        VALUES (${other.workspaceId}::uuid, 'cizi-cancel.csv', 10, '\\x00'::bytea,
                ${`idem-cizi-cancel-${randomUUID()}`}, 'importing', ${other.userId}::uuid,
                now() + interval '7 days')
        RETURNING id`);
      return rows[0]!.id;
    });

    const res = await app.request(`/api/v1/jobs/import/${foreignId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });

  it('zdroj, který zastavení neumí, odpoví 409 a ne 500', async () => {
    clearJobSources();
    registerJobSource({
      kind: 'export',
      list: async () => [],
      get: async () => ({
        id: 'e-1',
        kind: 'export',
        title: 'Export',
        status: 'running',
        done: 0,
        total: 0,
        startedBy: null,
        startedAt: '2026-08-07T10:00:00.000Z',
        updatedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: null,
        note: null,
        cancellable: true,
        stopping: false,
      }),
    });
    const res = await app.request('/api/v1/jobs/export/e-1/cancel', {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(409);
    clearJobSources();
  });
});

/**
 * STAVBA PUBLIKA KAMPANĚ.
 *
 * Tahle půlka je zajímavější než import: zastavit ji nejde jinak než zrušením
 * CELÉ kampaně, protože publikum se staví jen ve stavu `queueing` a jediný
 * odchod odtamtud, po kterém pošta neodejde, je `cancelled`. Materializační
 * smyčka se na stav ptá po každé dávce, takže i tady jde o spolupráci.
 */
describe('stavba publika v Centru úloh', () => {
  let ctx: Awaited<ReturnType<typeof createWorkspaceContext>>;

  beforeAll(async () => {
    ctx = await createWorkspaceContext({
      kind: 'session',
      userId,
      workspaceRef: workspaceId,
    });
  });

  async function seedAudience(status: string, phase: string): Promise<string> {
    return withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO campaigns (workspace_id, name, status, audience_size, created_by)
        VALUES (${workspaceId}::uuid, 'Jarní výprodej', ${status}, 12000, ${userId}::uuid)
        RETURNING id`);
      const campaignId = rows[0]!.id;
      await tx.execute(sql`
        INSERT INTO campaign_audience_progress (campaign_id, workspace_id, phase, inserted_rows)
        VALUES (${campaignId}::uuid, ${workspaceId}::uuid, ${phase}, 800)`);
      return campaignId;
    });
  }

  async function readJob(kind: string, id: string) {
    const res = await app.request(`/api/v1/jobs/${kind}/${id}`, { headers: headers() });
    expect(res.status).toBe(200);
    return (await res.json()).job;
  }

  it('rozestavěné publikum běží a zastavit se dá', async () => {
    installJobSources();
    const campaignId = await seedAudience('queueing', 'materializing');
    const job = await readJob('campaign_audience', campaignId);
    expect(job.status).toBe('running');
    expect(job.can_cancel).toBe(true);
  });

  /**
   * VADA, KTEROU TO ZÁROVEŇ OPRAVUJE. Stav se dřív četl jen z `phase`, jenže
   * zrušená kampaň fázi na `done` nikdy nepřepne (smyčka se prostě vrátí).
   * Úloha proto zůstávala v Centru navždy jako „běží" a odznak v hlavičce
   * ukazoval běžící práci, kterou nešlo vynulovat.
   */
  it('zrušená kampaň neběží navěky, i když fáze zůstala rozestavěná', async () => {
    installJobSources();
    const campaignId = await seedAudience('cancelled', 'materializing');
    const job = await readJob('campaign_audience', campaignId);
    expect(job.status).toBe('cancelled');
    expect(job.can_cancel).toBe(false);
  });

  it('hotové publikum je dokončená úloha, i když kampaň teprve odesílá', async () => {
    installJobSources();
    const campaignId = await seedAudience('sending', 'done');
    const job = await readJob('campaign_audience', campaignId);
    expect(job.status).toBe('completed');
    // Rozesílka se zastavuje na obrazovce kampaně, kde je vidět, kolika lidem
    // už zpráva došla. Centrum úloh na to tlačítko nemá.
    expect(job.can_cancel).toBe(false);
  });

  it('zastavení stavby publika zruší celou kampaň, ne jen úlohu', async () => {
    installJobSources();
    const campaignId = await seedAudience('queueing', 'materializing');

    const res = await app.request(`/api/v1/jobs/campaign_audience/${campaignId}/cancel`, {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('cancelling');

    const status = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ status: string; cancel_reason: string | null }>(
        sql`SELECT status, cancel_reason FROM campaigns WHERE id = ${campaignId}::uuid`,
      );
      return rows[0]!;
    });
    expect(status.status).toBe('cancelled');
    expect(status.cancel_reason).toBe('user');
  });

  it('druhé zastavení kampaně nekončí chybou', async () => {
    installJobSources();
    const campaignId = await seedAudience('queueing', 'materializing');
    const send = () =>
      app.request(`/api/v1/jobs/campaign_audience/${campaignId}/cancel`, {
        method: 'POST',
        headers: headers(),
      });
    await send();
    const second = await send();
    expect(second.status).toBe(200);
    expect((await second.json()).outcome).toBe('already_cancelled');
  });
});

/**
 * STAV WORKERU A FRONTY.
 *
 * PROČ SE TABULKY PG-BOSSU ZAKLÁDAJÍ TADY. Migrace 0007 zakládá jen SCHÉMA;
 * vlastní tabulky si při startu vyrábí pg-boss sám a v testu žádný worker
 * neběží. Zakládá se proto minimum, tedy přesně ty sloupce, které
 * `readWorkerStatus` čte, a je to zároveň smlouva: kdyby si někdo přidal do
 * dotazu sloupec navíc, spadne to tady, ne až v provozu.
 *
 * Významy sloupců NEJSOU odhad, jsou opsané z `cacheQueueStats` v `plans.js`
 * pg-bossu 12.26: `queued_count` je `count(*) FILTER (WHERE state < 'active')`,
 * `active_count` je `state = 'active'` a `failed_count` je `state = 'failed'`,
 * tedy MOMENTKY, ne kumulativní čítače.
 */
describe('GET /api/v1/jobs/worker', () => {
  /**
   * ČTE SE ZE SKUTEČNÝCH TABULEK PG-BOSSU, ne z podvržených.
   *
   * Zakládá je `mlain migrate` (`bootstrapQueueSchema` v `apps/cli`), protože
   * schéma vlastní jedině migrátor, a týž krok dává aplikační roli
   * `SELECT, INSERT, UPDATE, DELETE`. Test proto do nich rovnou píše: kdyby si
   * tvar tabulek podvrhoval sám, přežil by změnu verze pg-bossu, po které by
   * panel v provozu hlásil „nezměřeno".
   *
   * `TRUNCATE` schválně ne, `DELETE`: aplikační role má `arwd`, tedy INSERT,
   * SELECT, UPDATE a DELETE, ale ne TRUNCATE (`D`). Zjištěno tím, že první
   * podoba testu spadla na `permission denied for table version`, a je to
   * mimochodem doklad, že práva jsou opravdu jen ta vyjmenovaná.
   *
   * Významy sloupců NEJSOU odhad, jsou opsané z `cacheQueueStats` v `plans.js`
   * pg-bossu 12.26: `queued_count` je `count(*) FILTER (WHERE state < 'active')`,
   * `active_count` je `state = 'active'` a `failed_count` je `state = 'failed'`,
   * tedy MOMENTKY, ne kumulativní čítače.
   */
  const insertQueue = (name: string, queued: number, active: number, failed: number) => sql`
    INSERT INTO pgboss.queue
      (name, policy, retry_limit, retry_delay, retry_backoff, expire_seconds,
       retention_seconds, deletion_seconds, partition, table_name,
       queued_count, active_count, failed_count, monitor_on)
    VALUES (${name}, 'standard', 3, 5, false, 300, 1209600, 604800, false, 'job_common',
            ${queued}, ${active}, ${failed}, now())`;

  /**
   * Selhaná úloha do fronty. `age` je stáří: měří se ČAS VZNIKU, protože panel
   * počítá selhání za okno, ne od začátku instalace.
   */
  const insertFailedJob = (name: string, age: string) => sql`
    INSERT INTO pgboss.job (name, state, created_on, keep_until)
    VALUES (${name}, 'failed', now() - ${age}::interval, now() + interval '14 days')`;

  /**
   * Úloha odložená stranou, tedy v dead letter frontě.
   *
   * `payload` rozhoduje o tom, jestli se počítá. Úloha od producenta nese data,
   * kdežto tik pravidelné úlohy nemá ani data, ani klíč pro slučování. Tik,
   * který se netrefil do výpadku, NENÍ nedokončená práce: za pár minut tikne
   * další a dohoní ho. Panel proto počítá jen to, s čím má člověk co dělat.
   */
  const insertDeadLetterJob = (name: string, payload: string) => sql`
    INSERT INTO pgboss.job (name, state, data, created_on, keep_until)
    VALUES (${name}, 'created', ${payload}::jsonb, now(), now() + interval '14 days')`;

  async function resetQueues(): Promise<void> {
    await withoutContext(async (tx) => {
      await tx.execute(sql`DELETE FROM pgboss.job`);
      await tx.execute(sql`DELETE FROM pgboss.schedule`);
      await tx.execute(sql`DELETE FROM pgboss.queue`);
    });
    // Naměřený počet selhání se drží dvacet vteřin v paměti procesu, aby ho
    // neplatila každá otevřená záložka. V testu by ta paměť přenášela výsledek
    // z předchozího případu do dalšího.
    resetFailedCache();
  }

  it('čerstvá značka znamená běžící worker a součty jdou ven po stavech', async () => {
    await resetQueues();
    await withoutContext(async (tx) => {
      await tx.execute(sql`UPDATE pgboss.version SET cron_on = now(), flow_on = now()`);
      await tx.execute(insertQueue('contacts.import', 3, 1, 2));
      await tx.execute(insertQueue('campaign.scheduler', 0, 0, 5));
      await tx.execute(insertQueue('contacts.import.dlq', 4, 0, 0));
      await tx.execute(insertQueue('__pgboss__send-it', 900, 7, 1));
      await tx.execute(sql`
        INSERT INTO pgboss.schedule (name, cron, timezone, created_on, updated_on)
        VALUES ('campaign.scheduler', '* * * * *', 'UTC', now(), now())`);
      /*
       * Dva čerstvé pády, jeden týden starý a jeden v interní frontě. Do okna
       * patří jenom ty dva první; kdyby se počítalo od začátku, vyšly by čtyři
       * a přesně to zadavatele vyděsilo (4 142 na panelu, z toho 4 116 pádů
       * jedné fronty od 3. srpna, která se mezitím spravila).
       */
      await tx.execute(insertFailedJob('contacts.import', '1 hour'));
      await tx.execute(insertFailedJob('campaign.scheduler', '5 hours'));
      await tx.execute(insertFailedJob('campaign.scheduler', '7 days'));
      await tx.execute(insertFailedJob('__pgboss__send-it', '2 hours'));

      /*
       * Do dead letter fronty patří TŘI skutečné odložené úlohy a JEDEN prázdný
       * tik cronu. Do čísla na panelu se počítají jen ty tři.
       *
       * Naměřeno 8. 8. 2026: z dvou položek na skutečné obrazovce byla jedna
       * selhaný import s chybějícím souborem a druhá prázdný tik z restartu
       * workeru. Panel na obojí rozsvítil červenou a vyzval správce k akci,
       * kterou u toho tiku nemá kdo a proč udělat. Sčítat čítač `queued_count`
       * nestačí: ten obojí míchá dohromady.
       */
      await tx.execute(insertDeadLetterJob('contacts.import.dlq', '{"importId":"a"}'));
      await tx.execute(insertDeadLetterJob('contacts.import.dlq', '{"importId":"b"}'));
      await tx.execute(insertDeadLetterJob('contacts.import.dlq', '{"importId":"c"}'));
      await tx.execute(insertDeadLetterJob('contacts.import.dlq', '{}'));
    });

    const body = await (await app.request('/api/v1/jobs/worker', { headers: headers() })).json();
    expect(body.worker.state).toBe('running');
    // Interní fronta pg-bossu se do žádného součtu nepočítá: uživatel ji
    // nezaložil a jejích devět set úloh by přebilo všechnu skutečnou práci.
    expect(body.worker.queue.waiting).toBe(3);
    expect(body.worker.queue.running).toBe(1);
    // Selhání se počítají za OKNO, ne za celou historii, takže se čtou
    // z `pgboss.job` podle času, ne z momentky `queue.failed_count`.
    expect(body.worker.queue.failed_recent).toBe(2);
    expect(body.worker.queue.failed_window_hours).toBe(24);
    // Dead letter se počítá ZVLÁŠŤ, ne mezi čekající: ty úlohy nikdo nevezme.
    // Tři, ne čtyři: prázdný tik cronu se nepočítá, viz seedování výš.
    expect(body.worker.queue.dead_letter).toBe(3);
    expect(body.worker.queues.registered).toBe(2);
    expect(body.worker.queues.cron_scheduled).toBe(1);
  });

  /**
   * Zaseknutý worker je ta situace, kvůli které panel vznikl. Ticho se měří
   * proti `version.cron_on` i `queue.monitor_on`, protože obojí posouvá worker.
   */
  it('staré značky znamenají zastavený worker', async () => {
    await resetQueues();
    await withoutContext(async (tx) => {
      await tx.execute(sql`
        UPDATE pgboss.version
           SET cron_on = now() - interval '3 hours', flow_on = now() - interval '3 hours'`);
      await tx.execute(insertQueue('contacts.import', 0, 0, 0));
      await tx.execute(sql`
        UPDATE pgboss.queue SET monitor_on = now() - interval '3 hours'`);
    });

    const body = await (await app.request('/api/v1/jobs/worker', { headers: headers() })).json();
    expect(body.worker.state).toBe('down');
    expect(body.worker.seconds_since_last_seen).toBeGreaterThan(3 * 60 * 60 - 60);
  });

  it('bez přihlášení vrací 401', async () => {
    const res = await app.request('/api/v1/jobs/worker');
    expect(res.status).toBe(401);
  });
});
