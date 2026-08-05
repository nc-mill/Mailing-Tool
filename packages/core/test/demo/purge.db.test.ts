import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { getFieldCatalog, type FieldCatalog } from '../../src/contacts/fields/catalog';
import { closePools } from '../../src/tx';
import { purgeDemoData, readDemoManifest, seedDemoData } from '../../src/demo/index';

let pg: TestPostgres;
let workspaceId: string;
/** Skutečný katalog polí projektu. Seed jím ověřuje ukázkové šablony. */
let fields: FieldCatalog;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
  fields = await getFieldCatalog(
    unsafeWorkspaceContext(workspaceId, { type: 'system', job: 'test' }),
  );
}, 240_000);

beforeEach(async () => {
  await pg.truncateWorkspaceData(workspaceId);
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
  // `getFieldCatalog` jde přes aplikační pool z `src/tx`, ne přes pooly opory.
  await closePools();
  await pg?.stop();
});

const count = async (table: string) =>
  Number(
    (
      await pg.sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`,
        [workspaceId],
      )
    )[0]!.n,
  );

const seed = () =>
  pg.inWorkspace(workspaceId, (tx) => seedDemoData(tx, { workspaceId, now: new Date(), fields }));
const purge = () => pg.inWorkspace(workspaceId, (tx) => purgeDemoData(tx, { workspaceId }));

describe('purgeDemoData', () => {
  it('smaže všechno, co seed založil, včetně kampaně a reportu', async () => {
    await seed();
    const report = await purge();
    expect(report.deleted.contacts).toBe(50);
    expect(await count('contacts')).toBe(0);
    expect(await count('campaigns')).toBe(0);
    expect(await count('segments')).toBe(0);
    expect(await count('templates')).toBe(0);
    expect(await count('lists')).toBe(0);
    expect(await count('tags')).toBe(0);
  });

  it('po smazání nezůstane ani jeden řádek ve vazebních tabulkách', async () => {
    // Tvrdý požadavek zadavatele: „beze zbytku". Osiřelý řádek v contact_tags
    // nebo v list_subscriptions by uživatel v UI neviděl, ale ukázkových dat
    // by se nikdy nezbavil úplně.
    await seed();
    await purge();
    expect(await count('contact_tags')).toBe(0);
    expect(await count('list_subscriptions')).toBe(0);
    expect(await count('campaign_stats')).toBe(0);
  });

  it('nesáhne na nic ostatního v projektu', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'skutecny@firma.cz', 'active', 'manual', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    await pg.sql(`INSERT INTO tags (workspace_id, name) VALUES ($1, 'Můj štítek')`, [workspaceId]);
    await seed();
    await purge();
    expect(await count('contacts')).toBe(1);
    expect(await count('tags')).toBe(1);
  });

  it('vyprázdní manifest, takže jde ukázková data nahrát znovu', async () => {
    await seed();
    await purge();
    expect(await pg.inWorkspace(workspaceId, (tx) => readDemoManifest(tx, workspaceId))).toBeNull();
    await expect(seed()).resolves.toBeDefined();
  });

  it('bez manifestu skončí bez chyby a nic nesmaže', async () => {
    const report = await purge();
    expect(report.deleted.contacts).toBe(0);
  });

  it('smaže i kontakt, který uživatel mezitím ručně upravil', async () => {
    await seed();
    await pg.sql(
      `UPDATE contacts SET source_ref = NULL, first_name = 'Přejmenovaná'
        WHERE workspace_id = $1 AND email = 'jana.novakova@example.com'`,
      [workspaceId],
    );
    await purge();
    expect(await count('contacts')).toBe(0);
  });

  it('zapíše do auditu akci demo_data.purged s počty', async () => {
    await seed();
    await purge();
    const rows = await pg.sql<{ metadata: { contacts: number } }>(
      "SELECT metadata FROM audit_log WHERE action = 'demo_data.purged' AND workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0]!.metadata.contacts).toBe(50);
  });

  it('smaže zprávy zkušebního odeslání, ale auditní stopu nechá', async () => {
    // Ukázková kampaň se neodesílá, ale uživatel z ukázkové šablony pošle
    // zkušební e-mail a tím vzniknou zprávy i události. Tenhle test drží
    // hranici slibu „beze zbytku" tam, kde opravdu je: objekty z manifestu
    // se smažou, append only tabulky zůstanou, protože migrace odebírá
    // roli mlain_app právo DELETE na message_events.
    const manifest = await seed();
    const [contact] = await pg.sql<{ id: string }>(
      'SELECT id FROM contacts WHERE workspace_id = $1 LIMIT 1',
      [workspaceId],
    );
    // INVARIANT I1: messages.created_at se musí rovnat campaigns.audience_built_at,
    // jinak zápis neprojde cizím klíčem fk_messages__campaign_audience.
    await pg.sql(
      `INSERT INTO messages (workspace_id, campaign_id, kind, contact_id, email, status,
                             sent_at, created_at)
       SELECT $1, c.id, 'test', $3, 'jana.novakova@example.com', 'sent', now(), c.audience_built_at
         FROM campaigns c WHERE c.id = $2`,
      [workspaceId, manifest.campaignIds[0], contact!.id],
    );

    await purge();
    expect(await count('messages')).toBe(0);
    expect(await count('campaigns')).toBe(0);
  });

  it('bez kontextu projektu NEMAŽE a neohlásí hotovo', async () => {
    // Nejtišší možná porucha téhle domény: pod aplikační rolí bez nastaveného
    // mlain.workspace_id vrátí SELECT nad workspaces prázdno, funkce vrátí
    // nulový report a uživatel se dozví, že je hotovo.
    await seed();
    const pool = pg.as('mlain_app');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT settings FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      expect(rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // Data jsou pořád na místě, protože se nic nesmazalo.
    expect(await count('contacts')).toBe(50);
  });
});
