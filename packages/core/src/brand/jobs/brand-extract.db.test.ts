import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';

/**
 * CELÝ ŘETĚZ proti skutečné databázi: složené závislosti, skutečný repozitář,
 * skutečná analýza stránky, skutečný zápis profilu a skutečná odchozí událost.
 *
 * Zmokovaná je JEN síť, a to na úrovni tří funkcí, které runtime vydává
 * (`checkRobots`, `fetchPage`, `fetchAssets`). Všechno ostatní je produkční kód
 * včetně `createBrandRuntime`, který se uvnitř továrny opravdu sestaví; kdyby
 * nešel sestavit, spadne tenhle test dřív, než se dostane k síti.
 *
 * Prostředí musí být hotové DŘÍV, než se natáhne cokoliv, co volá `loadConfig()`.
 */
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATA_DIR'] ??= '/tmp';
process.env['MODE'] = 'web';
process.env['MIGRATE_ON_START'] ??= 'false';

const { withTestWorkspace, migratorClient } = await import('../../campaigns/test/harness');
const { rawSql } = await import('../../campaigns/repo/raw-sql');
const { withWorkspace } = await import('../../tx');
const { createBrandExtractDeps } = await import('./brand-extract-deps');
const { runBrandExtraction } = await import('./brand-extract');

/**
 * Tabulky pg-boss zakládá až worker při startu, migrace jen schéma. Harness
 * domény kampaní je nezakládá, takže si je tenhle soubor doloží sám: bez nich
 * by zařazení fan-outu spadlo na „relation pgboss.job does not exist" a vypadalo
 * by to jako chyba domény značky.
 *
 * Registruje se AŽ TADY, tedy po `beforeAll` harnessu, který teprve nastaví
 * `DATABASE_URL_MIGRATOR` na čerstvě zaklonovanou databázi.
 */
beforeAll(async () => {
  const url = process.env['DATABASE_URL_MIGRATOR'];
  if (url === undefined) throw new Error('harness nenastavil DATABASE_URL_MIGRATOR');
  const boss = new PgBoss({
    connectionString: url,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.createQueue('platform.webhook_fanout');
  await boss.stop({ graceful: false });

  const { Pool } = await import('pg');
  const migrator = new Pool({ connectionString: url, max: 1 });
  // Zapisuje aplikační role, tedy ta, pod kterou běží produkce.
  await migrator.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
  await migrator.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
  await migrator.end();
}, 120_000);

const PAGE = [
  '<html><head>',
  '<meta name="theme-color" content="#c41e3a">',
  '<style>:root{--brand:#c41e3a} body{font-family:Georgia,serif;border-radius:6px}</style>',
  '</head><body><h1>Kolo Shop</h1><p>Prodáváme kola už dvacet let.</p></body></html>',
].join('');

type Snapshot = {
  status: string;
  error_code: string | null;
  brand_profile_id: string | null;
  bytes_fetched: string | number;
  finished_at: Date | null;
  result: { warnings?: string[] } | null;
};

async function snapshot(id: string): Promise<Snapshot | null> {
  const { rows } = await migratorClient().query<Snapshot>(
    `SELECT status, error_code, brand_profile_id, bytes_fetched, finished_at, result
       FROM brand_extractions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function countProfiles(workspaceId: string): Promise<number> {
  const { rows } = await migratorClient().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM brand_profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return Number(rows[0]?.n ?? '0');
}

async function seed(workspace: Awaited<ReturnType<typeof withTestWorkspace>>): Promise<string> {
  const id = randomUUID();
  await withWorkspace(workspace.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO brand_extractions (id, workspace_id, input_url, normalized_url, status)
         VALUES ($1, $2, 'https://kolo-shop.cz', 'https://kolo-shop.cz/', 'pending')`,
        [id, workspace.workspaceId],
      ),
    ),
  );
  return id;
}

/** Síť. Skutečné `fetchPage` se sem nedostane, ostatní kód ano. */
function withStubbedNetwork(
  deps: ReturnType<typeof createBrandExtractDeps>,
  over: Partial<ReturnType<typeof createBrandExtractDeps>> = {},
): ReturnType<typeof createBrandExtractDeps> {
  return {
    ...deps,
    checkRobots: async () => ({ allowed: true }),
    fetchPage: async () => ({
      ok: true as const,
      finalUrl: 'https://kolo-shop.cz/',
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from(PAGE),
      hops: [{ url: 'https://kolo-shop.cz/', status: 200, ipClass: 'public' as const }],
      bytesRead: PAGE.length,
    }),
    fetchAssets: async () => [],
    ...over,
  };
}

describe('extrakce značky od nákladu úlohy po řádky v databázi', () => {
  it('běh v pending skončí jako succeeded a založí profil značky', async () => {
    const ws = await withTestWorkspace();
    const id = await seed(ws);

    const before = await snapshot(id);
    expect(before?.status, 'PŘED: pending, bez profilu a bez času dokončení').toBe('pending');
    expect(before?.brand_profile_id).toBeNull();
    expect(before?.finished_at).toBeNull();
    expect(await countProfiles(ws.workspaceId), 'PŘED: projekt nemá žádnou značku').toBe(0);

    await runBrandExtraction(
      { extractionId: id },
      withStubbedNetwork(createBrandExtractDeps(ws.workspace)),
    );

    const after = await snapshot(id);
    expect(after?.status, 'PO: běh doběhl').toBe('succeeded');
    expect(after?.error_code).toBeNull();
    expect(after?.brand_profile_id, 'PO: běh ukazuje na založený profil').not.toBeNull();
    expect(after?.finished_at).not.toBeNull();
    expect(Number(after?.bytes_fetched)).toBe(PAGE.length);
    // Tón se neodvozuje: projekt nemá klíč providera, takže se model vůbec
    // nestaví a nejde ven jediný požadavek (kritérium 7b).
    expect(after?.result?.warnings).toContain('tone_inference_disabled');

    expect(await countProfiles(ws.workspaceId), 'PO: profil značky vznikl').toBe(1);

    const { rows: profiles } = await migratorClient().query<{
      name: string;
      source_url: string;
      palette: { primary: string };
    }>(`SELECT name, source_url, palette FROM brand_profiles WHERE id = $1`, [
      after!.brand_profile_id,
    ]);
    expect(profiles[0]?.name).toBe('kolo-shop.cz');
    expect(profiles[0]?.source_url).toBe('https://kolo-shop.cz/');
    // Barva z `theme-color` stránky, ne výchozí paleta: analýza opravdu proběhla.
    expect(profiles[0]?.palette.primary).toBe('#c41e3a');

    // Odchozí událost a její fan-out jdou v jedné transakci. Bez zařazení jobu
    // by událost v tabulce ležela a nikdo by ji nerozeslal.
    const { rows: events } = await migratorClient().query<{ type: string }>(
      `SELECT type FROM webhook_events WHERE workspace_id = $1`,
      [ws.workspaceId],
    );
    expect(events.map((row) => row.type)).toContain('brand.extraction_completed');

    const { rows: jobs } = await migratorClient().query<{ name: string }>(
      `SELECT name FROM pgboss.job WHERE data ->> 'workspace_id' = $1`,
      [ws.workspaceId],
    );
    expect(jobs.map((row) => row.name)).toContain('platform.webhook_fanout');
  });

  it('zákaz z robots.txt skončí jako blocked, ne failed, a profil nevznikne', async () => {
    const ws = await withTestWorkspace();
    const id = await seed(ws);

    await runBrandExtraction(
      { extractionId: id },
      withStubbedNetwork(createBrandExtractDeps(ws.workspace), {
        checkRobots: async () => ({ allowed: false, code: 'brand_robots_disallowed' }),
      }),
    );

    const after = await snapshot(id);
    expect(after?.status).toBe('blocked');
    expect(after?.error_code).toBe('brand_robots_disallowed');
    expect(after?.brand_profile_id).toBeNull();
    expect(await countProfiles(ws.workspaceId)).toBe(0);
  });

  it('síťová chyba skončí jako failed', async () => {
    const ws = await withTestWorkspace();
    const id = await seed(ws);

    await runBrandExtraction(
      { extractionId: id },
      withStubbedNetwork(createBrandExtractDeps(ws.workspace), {
        fetchPage: async () => ({
          ok: false as const,
          code: 'brand_timeout',
          hops: [],
          bytesRead: 0,
        }),
      }),
    );

    const after = await snapshot(id);
    expect(after?.status).toBe('failed');
    expect(after?.error_code).toBe('brand_timeout');
  });

  /**
   * REGRESE: extrakce z cizího projektu. Bez kontroly by obsluha pod svým
   * kontextem řádek nenačetla a musí to říct nahlas, ne skončit úspěchem.
   */
  it('extrakce, na kterou projekt nedosáhne, skončí výjimkou', async () => {
    const owner = await withTestWorkspace();
    const stranger = await withTestWorkspace();
    const id = await seed(owner);

    await expect(
      runBrandExtraction(
        { extractionId: id },
        withStubbedNetwork(createBrandExtractDeps(stranger.workspace)),
      ),
    ).rejects.toThrow(/neexistuje/);

    expect((await snapshot(id))?.status, 'cizí běh zůstal nedotčený').toBe('pending');
  });
});
