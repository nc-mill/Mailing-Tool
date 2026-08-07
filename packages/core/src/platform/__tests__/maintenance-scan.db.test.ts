import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  migratorClient,
  seedCampaign,
  seedProvider,
  withTestWorkspace,
  type TestWorkspace,
} from '../../campaigns/test/harness';
import { withWorkspace } from '../../tx';
import { rawSql } from '../../campaigns/repo/raw-sql';
import { handler as purgeWorkspaces } from '../jobs/purge_workspaces';
import { listDueDomains, listRunningCampaigns, listWorkspaceIds } from '../maintenance-scan';

/**
 * Izolace projektů je hlavní bezpečnostní vlastnost produktu, a role
 * `mlain_maintenance` je z ní JEDINÁ výjimka. Tenhle soubor je její popis
 * vynucený spuštěním, ne komentářem.
 *
 * Ptá se na čtyři věci a každá z nich už jednou selhala v provozu:
 *
 *  1. Vidí ta role napříč projekty tam, kde má? (Bez toho se naplánovaná
 *     kampaň nikdy neodešle a plánovač přitom skončí úspěchem.)
 *  2. Nevidí NIC jinde? (Výjimka, která se rozlije na kontakty a zprávy, je
 *     horší než původní vada.)
 *  3. Drží izolace pro `mlain_app` beze změny? (Kdyby ji nová politika
 *     uvolnila, nepoznal by to nikdo.)
 *  4. Smí ta role smazat jen projekt, který UŽ JE měkce smazaný?
 *
 * OVĚŘENO, ŽE TEST BEZ POLITIK PADÁ: po `DROP POLICY maintenance_scan
 * ON workspaces` vrátí sken prázdný seznam a první tvrzení skončí na
 * `expected [] to contain '…'`. Bez toho by šlo o test, který jen potvrzuje,
 * že databáze funguje.
 */

let maintenance: Pool;
let appNoContext: Pool;

/** Tabulky, na které výjimka NEDOPADÁ. Výběr není náhodný: jsou to ty, kde leží osobní údaje. */
const FORBIDDEN_TABLES = ['contacts', 'messages', 'consents', 'audit_log', 'memberships', 'users'];

beforeAll(() => {
  const url = process.env['DATABASE_URL_MAINTENANCE'];
  if (url === undefined) throw new Error('harness nenastavil DATABASE_URL_MAINTENANCE');
  maintenance = new Pool({ connectionString: url, max: 2 });
  // Spojení pod `mlain_app` BEZ kontextu projektu, tedy přesně to, pod čím
  // worker skenoval dřív a nic nenašel.
  const appUrl = process.env['DATABASE_URL'];
  if (appUrl === undefined) throw new Error('harness nenastavil DATABASE_URL');
  appNoContext = new Pool({ connectionString: appUrl, max: 2 });
});

afterAll(async () => {
  await maintenance?.end();
  await appNoContext?.end();
});

/** Odesílací doména, jejíž kontrola je na řadě. Harness na ni seed nemá. */
async function seedDueDomain(ctx: TestWorkspace, providerId: string): Promise<string> {
  return withWorkspace(ctx.workspace, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `INSERT INTO sender_domains
           (workspace_id, provider_id, domain, spf_ok, dkim_ok, next_check_at)
         VALUES ($1, $2, $3, true, true, now() - interval '1 minute')
         RETURNING id`,
        [
          ctx.workspaceId,
          providerId,
          `d${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cz`,
        ],
      ),
    );
    return r.rows[0]!.id;
  });
}

describe('výjimka z izolace projektů pro mlain_maintenance', () => {
  let a: TestWorkspace;
  let b: TestWorkspace;
  let campaignA: string;
  let campaignB: string;
  let domainA: string;

  beforeAll(async () => {
    a = await withTestWorkspace();
    b = await withTestWorkspace();
    campaignA = await seedCampaign(a, { status: 'sending' });
    campaignB = await seedCampaign(b, { status: 'sending' });
    const providerA = await seedProvider(a, { status: 'ready' });
    domainA = await seedDueDomain(a, providerA);
  }, 300_000);

  it('vidí projekty NAPŘÍČ instalací', async () => {
    const ids = await listWorkspaceIds();
    expect(ids).toContain(a.workspaceId);
    expect(ids).toContain(b.workspaceId);
  });

  it('vidí kampaně napříč projekty, tedy i cizí', async () => {
    const running = (await listRunningCampaigns()).map((c) => c.campaignId);
    expect(running).toContain(campaignA);
    expect(running).toContain(campaignB);
  });

  it('vidí odesílací domény, kterým nastal čas kontroly', async () => {
    const due = (await listDueDomains(100)).map((d) => d.domainId);
    expect(due).toContain(domainA);
  });

  /**
   * Nejdůležitější tvrzení celého souboru. Rozdíl mezi „nevidí" a „nesmí" je tu
   * podstatný: čekáme CHYBU OPRÁVNĚNÍ (42501), ne prázdný výsledek. Prázdný
   * výsledek by znamenal, že grant existuje a chybí jen politika, tedy že to
   * příští úprava politik může tiše otevřít.
   */
  it('na ostatní tabulky NEMÁ PRÁVO vůbec', async () => {
    for (const table of FORBIDDEN_TABLES) {
      await expect(
        maintenance.query(`SELECT count(*) FROM ${table}`),
        `${table} musí být pro mlain_maintenance zakázaná`,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  /**
   * `imports` a `segments` přibyly migrací 0024 a mají grant SLOUPCOVÝ, ne na
   * celou tabulku. Rozdíl je podstatný: sken z nich potřebuje identifikaci
   * a pár řídicích sloupců, kdežto `imports.error_summary` nese UKÁZKY HODNOT
   * z nahraného CSV, tedy potenciálně e-maily a jména kontaktů,
   * `imports.filename` bývá jméno člověka nebo firmy a `segments.definition`
   * je práce uživatele.
   *
   * Kdyby grant vznikl na celou tabulku, tenhle test spadne. Je to jediné
   * místo, které ten rozdíl hlídá, protože v běžném provozu se na ty sloupce
   * nikdo pod touhle rolí nezeptá a chyba by nebyla vidět.
   */
  it('z imports a segments přečte JEN identifikaci, ne obsah', async () => {
    const allowed: Array<[string, string]> = [
      ['imports', 'SELECT id, workspace_id, status, updated_at FROM imports LIMIT 1'],
      ['segments', 'SELECT id, workspace_id, deleted_at, kind, cached_at FROM segments LIMIT 1'],
    ];
    for (const [table, query] of allowed) {
      await expect(
        maintenance.query(query),
        `${table} musí jít přečíst ve sloupcích, které sken potřebuje`,
      ).resolves.toBeTruthy();
    }

    const forbiddenColumns: Array<[string, string]> = [
      ['imports.filename', 'SELECT filename FROM imports'],
      ['imports.error_summary', 'SELECT error_summary FROM imports'],
      ['imports.mapping', 'SELECT mapping FROM imports'],
      ['segments.definition', 'SELECT definition FROM segments'],
      ['segments.name', 'SELECT name FROM segments'],
    ];
    for (const [label, query] of forbiddenColumns) {
      await expect(
        maintenance.query(query),
        `${label} nesmí být pro mlain_maintenance čitelný`,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('do imports ani segments nesmí zapisovat', async () => {
    await expect(maintenance.query(`UPDATE imports SET status = 'failed'`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(maintenance.query(`UPDATE segments SET cached_at = now()`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(maintenance.query(`DELETE FROM imports`)).rejects.toMatchObject({ code: '42501' });
  });

  it('do workspaces ani campaigns nesmí zapisovat', async () => {
    await expect(
      maintenance.query(`UPDATE workspaces SET name = 'zmena' WHERE id = $1`, [a.workspaceId]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      maintenance.query(`UPDATE campaigns SET status = 'draft' WHERE id = $1`, [campaignA]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  /**
   * Izolace se novou rolí NESMÍ rozvolnit. Kdyby politika `maintenance_scan`
   * vznikla bez klauzule `TO mlain_maintenance`, platila by pro všechny role
   * a tenhle test by spadl. Přesně tahle překlepová chyba je důvod, proč tu je.
   */
  it('mlain_app bez kontextu projektu dál nevidí ani řádek', async () => {
    const ws = await appNoContext.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workspaces`,
    );
    expect(ws.rows[0]!.n).toBe('0');
    const camp = await appNoContext.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM campaigns`,
    );
    expect(camp.rows[0]!.n).toBe('0');
  });

  it('mlain_app v kontextu projektu vidí VÝHRADNĚ svůj projekt', async () => {
    const seen = await withWorkspace(a.workspace, async (tx) => {
      const r = await tx.execute<{ id: string }>(rawSql(`SELECT id FROM campaigns`, []));
      return r.rows.map((row) => row.id);
    });
    expect(seen).toContain(campaignA);
    expect(seen).not.toContain(campaignB);
  });
});

describe('úklid smazaných projektů', () => {
  /**
   * Ověření nálezu I82 v jeho původním znění: projekt smazaný před 60 dny se
   * pod aplikační rolí nesmazal a `DELETE` vrátil nulu, aniž by cokoli selhalo.
   */
  it('smaže projekt měkce smazaný před 60 dny a vrátí přesně jeden', async () => {
    const doomed = await withTestWorkspace();
    await migratorClient().query(
      `UPDATE workspaces SET deleted_at = now() - interval '60 days' WHERE id = $1`,
      [doomed.workspaceId],
    );

    const deleted = await purgeWorkspaces();
    expect(deleted).toBe(1);

    const { rows } = await migratorClient().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workspaces WHERE id = $1`,
      [doomed.workspaceId],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('projekt smazaný VČERA nechá být, lhůta na obnovu ještě běží', async () => {
    const recent = await withTestWorkspace();
    await migratorClient().query(
      `UPDATE workspaces SET deleted_at = now() - interval '1 day' WHERE id = $1`,
      [recent.workspaceId],
    );

    expect(await purgeWorkspaces()).toBe(0);
  });

  /**
   * Politika `maintenance_purge`, ne dotaz úlohy: kdyby se role spletla a
   * poslala `DELETE` bez podmínky na `deleted_at`, nesmí smazat živý projekt.
   * Je to poslední pojistka před nevratnou ztrátou dat celého zákazníka.
   */
  it('ŽIVÝ projekt nesmaže ani přímým DELETE bez podmínky', async () => {
    const alive = await withTestWorkspace();
    const r = await maintenance.query(`DELETE FROM workspaces WHERE id = $1`, [alive.workspaceId]);
    expect(r.rowCount).toBe(0);

    const { rows } = await migratorClient().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workspaces WHERE id = $1`,
      [alive.workspaceId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});
