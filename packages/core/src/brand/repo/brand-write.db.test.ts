import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * Zápisová část domény značky proti SKUTEČNÉ databázi, ne proti `vi.fn()`.
 *
 * Mock by neodhalil chybějící sloupec ani porušené `CHECK`, což je přesně ta
 * třída vad, kterou tenhle projekt opakovaně chytal až v provozu. Testuje se
 * proto celý přechod stavů: `pending` -> `running` -> `succeeded`, plus úklid
 * zaseknutého běhu.
 *
 * Prostředí musí být hotové DŘÍV, než se natáhne cokoliv, co volá `loadConfig()`.
 * Testovací databázi doplní globální setup, tohle je zbytek minima.
 */
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATA_DIR'] ??= '/tmp';
process.env['MODE'] = 'web';
process.env['MIGRATE_ON_START'] ??= 'false';

const { withTestWorkspace, migratorClient } = await import('../../campaigns/test/harness');
const { rawSql } = await import('../../campaigns/repo/raw-sql');
const { withWorkspace } = await import('../../tx');
const { failStaleExtractions, findExtraction, finishExtraction, markRunning } =
  await import('./extractions.repo');
const { insertBrandProfile } = await import('./profiles.repo');

type ExtractionSnapshot = {
  status: string;
  error_code: string | null;
  brand_profile_id: string | null;
  bytes_fetched: string | number;
  duration_ms: number | null;
  finished_at: Date | null;
  result: unknown;
};

/** Kontrolní čtení jde pod migrátorskou rolí, aby ho neovlivnila tatáž RLS. */
async function snapshot(id: string): Promise<ExtractionSnapshot | null> {
  const { rows } = await migratorClient().query<ExtractionSnapshot>(
    `SELECT status, error_code, brand_profile_id, bytes_fetched, duration_ms, finished_at, result
       FROM brand_extractions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function seedExtraction(
  workspace: Awaited<ReturnType<typeof withTestWorkspace>>,
  status = 'pending',
  createdAt: Date | null = null,
): Promise<string> {
  const id = randomUUID();
  await withWorkspace(workspace.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO brand_extractions
           (id, workspace_id, input_url, normalized_url, status, created_at)
         VALUES ($1, $2, 'https://kolo-shop.cz', 'https://kolo-shop.cz/', $3, COALESCE($4::timestamptz, now()))`,
        [id, workspace.workspaceId, status, createdAt === null ? null : createdAt.toISOString()],
      ),
    ),
  );
  return id;
}

describe('zápisová část brand_extractions proti databázi', () => {
  it('pending -> running -> succeeded, včetně profilu značky', async () => {
    const ws = await withTestWorkspace();
    const id = await seedExtraction(ws);

    const before = await snapshot(id);
    expect(before?.status, 'PŘED: běh čeká ve frontě').toBe('pending');
    expect(before?.finished_at).toBeNull();
    expect(before?.brand_profile_id).toBeNull();

    const taken = await withWorkspace(ws.workspace, (tx) => markRunning(tx, id));
    expect(taken, 'první převzetí musí projít').toBe(true);
    expect((await snapshot(id))?.status, 'MEZITÍM: běh je převzatý').toBe('running');

    const profile = await withWorkspace(ws.workspace, (tx) =>
      insertBrandProfile(tx, {
        workspaceId: ws.workspaceId,
        name: 'kolo-shop.cz',
        sourceUrl: 'https://kolo-shop.cz/',
        logoAssetId: null,
        logoDarkAssetId: null,
        palette: { primary: '#c41e3a', source: { primary: 'meta' } },
        typography: { headingStack: 'arial', bodyStack: 'arial', radius: 4 },
      }),
    );
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);

    await withWorkspace(ws.workspace, (tx) =>
      finishExtraction(tx, {
        id,
        status: 'succeeded',
        errorCode: null,
        hopSummary: [{ url: 'https://kolo-shop.cz/', status: 200, ipClass: 'public' }],
        bytesFetched: 1234,
        durationMs: 567,
        result: { warnings: ['logo_not_measured'] },
        brandProfileId: profile.id,
      }),
    );

    const after = await snapshot(id);
    expect(after?.status, 'PO: běh je hotový').toBe('succeeded');
    expect(after?.brand_profile_id).toBe(profile.id);
    expect(Number(after?.bytes_fetched)).toBe(1234);
    expect(after?.duration_ms).toBe(567);
    expect(after?.finished_at).not.toBeNull();
    expect(after?.result).toEqual({ warnings: ['logo_not_measured'] });

    // Čtení přes repozitář vidí týž stav, včetně projektu, podle kterého si
    // obsluha ověřuje, že náklad úlohy míří tam, kde ho zpracovává.
    const row = await withWorkspace(ws.workspace, (tx) => findExtraction(tx, id));
    expect(row).toMatchObject({
      id,
      workspaceId: ws.workspaceId,
      status: 'succeeded',
      brandProfileId: profile.id,
    });
  });

  /**
   * pg-boss doručí úlohu i podruhé, když worker spadne po převzetí a před
   * potvrzením. Druhé převzetí musí vrátit `false`, jinak by dvě souběžná
   * stahování téhož webu přepsala výsledek toho prvního.
   */
  it('druhé převzetí téhož běhu neprojde', async () => {
    const ws = await withTestWorkspace();
    const id = await seedExtraction(ws);

    expect(await withWorkspace(ws.workspace, (tx) => markRunning(tx, id))).toBe(true);
    expect(await withWorkspace(ws.workspace, (tx) => markRunning(tx, id))).toBe(false);
    expect((await snapshot(id))?.status).toBe('running');
  });

  /** Koncový stav se nepřepisuje: opakovaný pokus zakládá nový řádek. */
  it('finishExtraction nepřepíše už uzavřený běh', async () => {
    const ws = await withTestWorkspace();
    const id = await seedExtraction(ws);
    await withWorkspace(ws.workspace, (tx) => markRunning(tx, id));

    const finish = (status: 'succeeded' | 'failed', errorCode: string | null) =>
      withWorkspace(ws.workspace, (tx) =>
        finishExtraction(tx, {
          id,
          status,
          errorCode,
          hopSummary: [],
          bytesFetched: 0,
          durationMs: 1,
          result: null,
          brandProfileId: null,
        }),
      );

    await finish('failed', 'brand_timeout');
    await finish('succeeded', null);

    const after = await snapshot(id);
    expect(after?.status).toBe('failed');
    expect(after?.error_code).toBe('brand_timeout');
  });

  it('stav mimo povolený výčet neprojde přes CHECK', async () => {
    const ws = await withTestWorkspace();
    const id = await seedExtraction(ws);
    await withWorkspace(ws.workspace, (tx) => markRunning(tx, id));

    await expect(
      withWorkspace(ws.workspace, (tx) =>
        finishExtraction(tx, {
          id,
          status: 'done' as never,
          errorCode: null,
          hopSummary: [],
          bytesFetched: 0,
          durationMs: 1,
          result: null,
          brandProfileId: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('zaseknutý běh se po limitu uzavře jako failed s brand_timeout', async () => {
    const ws = await withTestWorkspace();
    const stale = await seedExtraction(ws, 'running', new Date(Date.now() - 60 * 60 * 1000));
    const fresh = await seedExtraction(ws, 'running');

    const failed = await withWorkspace(ws.workspace, (tx) =>
      failStaleExtractions(tx, new Date(Date.now() - 5 * 60 * 1000), 'brand_timeout'),
    );

    expect(failed).toBe(1);
    expect((await snapshot(stale))?.status).toBe('failed');
    expect((await snapshot(stale))?.error_code).toBe('brand_timeout');
    expect((await snapshot(fresh))?.status, 'čerstvý běh se nesmí zabít').toBe('running');
  });

  /**
   * Izolace projektů. Zápis se nespoléhá na `WHERE workspace_id`, spoléhá na
   * RLS; kdyby politika chyběla, cizí projekt by šlo přepsat a nikdo by to
   * nepoznal.
   */
  it('cizí projekt na řádek nedosáhne', async () => {
    const owner = await withTestWorkspace();
    const stranger = await withTestWorkspace();
    const id = await seedExtraction(owner);

    expect(await withWorkspace(stranger.workspace, (tx) => findExtraction(tx, id))).toBeNull();
    expect(await withWorkspace(stranger.workspace, (tx) => markRunning(tx, id))).toBe(false);
    expect((await snapshot(id))?.status).toBe('pending');
  });
});
