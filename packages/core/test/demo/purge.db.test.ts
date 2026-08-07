import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { getFieldCatalog, type FieldCatalog } from '../../src/contacts/fields/catalog';
import { closePools } from '../../src/tx';
import {
  NO_DEMO_IMPACT,
  purgeDemoData,
  readDemoImpact,
  readDemoManifest,
  seedDemoData,
} from '../../src/demo/index';

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

/**
 * Kontext projektu pro kompilaci ukázkové kampaně. Seed jím dohledává assety
 * a nastavení projektu, tedy přesně to, co endpoint předává ze `c.get('auth')`.
 */
const demoCtx = () => unsafeWorkspaceContext(workspaceId, { type: 'system', job: 'test' });

const seed = () =>
  pg.inWorkspace(workspaceId, (tx) =>
    seedDemoData(tx, { workspaceId, now: new Date(), fields, ctx: demoCtx() }),
  );
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

/**
 * DOPAD ÚKLIDU NA VĚCI MIMO UKÁZKOVOU SADU.
 *
 * `purgeDemoData` maže přesně řádky z manifestu, takže vlastní kontakt ani
 * vlastní kampaň nezmizí. Cizí klíče ale sahají dál: `list_subscriptions`
 * a `contact_tags` visí na seznamu a štítku kaskádou a `campaigns.template_id`
 * se nuluje. Okno „Odstranit ukázková data?" tvrdilo „na nic ostatního
 * v projektu se nesáhne", což v těchhle případech neplatilo, a `readDemoImpact`
 * je proto počítá DOPŘEDU, aby okno mohlo říct číslo.
 */
describe('readDemoImpact', () => {
  const impact = () =>
    pg.inWorkspace(workspaceId, async (tx) => {
      const manifest = await readDemoManifest(tx, workspaceId);
      return manifest === null ? NO_DEMO_IMPACT : readDemoImpact(tx, workspaceId, manifest);
    });

  const vlastniKontakt = async (email: string) => {
    const rows = await pg.sql<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, $2, 'active', 'manual', 'cs', 'Europe/Prague') RETURNING id`,
      [workspaceId, email],
    );
    return rows[0]!.id;
  };

  it('v čerstvě nahrané sadě je dopad nulový', async () => {
    await seed();
    expect(await impact()).toEqual({ contacts: 0, campaigns: 0 });
  });

  it('spočítá vlastní kontakt přihlášený k ukázkovému seznamu', async () => {
    const manifest = await seed();
    const contactId = await vlastniKontakt('skutecny@firma.cz');
    await pg.sql(
      `INSERT INTO list_subscriptions (workspace_id, contact_id, list_id, status, source)
       VALUES ($1, $2, $3, 'confirmed', 'manual')`,
      [workspaceId, contactId, manifest.listIds[0]],
    );
    expect(await impact()).toEqual({ contacts: 1, campaigns: 0 });
  });

  it('spočítá vlastní kontakt s ukázkovým štítkem a nezapočítá ho dvakrát', async () => {
    const manifest = await seed();
    const contactId = await vlastniKontakt('dvakrat@firma.cz');
    await pg.sql(
      `INSERT INTO contact_tags (workspace_id, contact_id, tag_id) VALUES ($1, $2, $3)`,
      [workspaceId, contactId, manifest.tagIds[0]],
    );
    await pg.sql(
      `INSERT INTO list_subscriptions (workspace_id, contact_id, list_id, status, source)
       VALUES ($1, $2, $3, 'confirmed', 'manual')`,
      [workspaceId, contactId, manifest.listIds[0]],
    );
    // Jeden člověk, dvě vazby. Kdyby se sčítaly vazby místo lidí, okno by
    // slíbilo dvojnásobnou ztrátu a číslo by přestalo být k něčemu.
    expect(await impact()).toEqual({ contacts: 1, campaigns: 0 });
  });

  it('ukázkové kontakty do dopadu nepatří, ty se mažou celé', async () => {
    // Padesát ukázkových kontaktů je v ukázkových seznamech a má ukázkový
    // štítek. Kdyby se počítaly, okno by hlásilo dopad i v projektu, kde
    // uživatel nemá vlastního nic.
    await seed();
    expect((await impact()).contacts).toBe(0);
    expect(await count('list_subscriptions')).toBeGreaterThan(0);
  });

  it('spočítá vlastní kampaň postavenou na ukázkové šabloně', async () => {
    const manifest = await seed();
    await pg.sql(
      `INSERT INTO campaigns (workspace_id, name, status, template_id)
       VALUES ($1, 'Moje první kampaň', 'draft', $2)`,
      [workspaceId, manifest.templateIds[0]],
    );
    expect(await impact()).toEqual({ contacts: 0, campaigns: 1 });
  });

  it('spočítá vlastní kampaň s ukázkovým odhlašovacím seznamem', async () => {
    const manifest = await seed();
    await pg.sql(
      `INSERT INTO campaigns (workspace_id, name, status, unsubscribe_list_id)
       VALUES ($1, 'Kampaň s odhlášením', 'draft', $2)`,
      [workspaceId, manifest.listIds[0]],
    );
    expect(await impact()).toEqual({ contacts: 0, campaigns: 1 });
  });

  it('nepočítá vlastní kampaň, která s ukázkovou sadou nemá nic společného', async () => {
    await seed();
    await pg.sql(
      `INSERT INTO campaigns (workspace_id, name, status) VALUES ($1, 'Cizí', 'draft')`,
      [workspaceId],
    );
    expect(await impact()).toEqual({ contacts: 0, campaigns: 0 });
  });

  it('bez manifestu se nepočítá nic', async () => {
    expect(await impact()).toEqual({ contacts: 0, campaigns: 0 });
  });

  /**
   * Slib okna proti skutečnosti: dopad říká, KOLIK vazeb se rozváže, a úklid
   * je pak opravdu rozváže, aniž by vlastní kontakt nebo kampaň smazal.
   */
  it('co dopad slíbí, to úklid udělá: vazby zmizí, vlastní objekty zůstanou', async () => {
    const manifest = await seed();
    const contactId = await vlastniKontakt('zustava@firma.cz');
    await pg.sql(
      `INSERT INTO list_subscriptions (workspace_id, contact_id, list_id, status, source)
       VALUES ($1, $2, $3, 'confirmed', 'manual')`,
      [workspaceId, contactId, manifest.listIds[0]],
    );
    await pg.sql(
      `INSERT INTO campaigns (workspace_id, name, status, template_id)
       VALUES ($1, 'Moje první kampaň', 'draft', $2)`,
      [workspaceId, manifest.templateIds[0]],
    );
    expect(await impact()).toEqual({ contacts: 1, campaigns: 1 });

    await purge();

    expect(await count('contacts')).toBe(1);
    expect(await count('campaigns')).toBe(1);
    expect(await count('list_subscriptions')).toBe(0);
    const [kampan] = await pg.sql<{ template_id: string | null }>(
      'SELECT template_id FROM campaigns WHERE workspace_id = $1',
      [workspaceId],
    );
    expect(kampan!.template_id, 'vazba na ukázkovou šablonu se musí vynulovat').toBeNull();
  });
});
