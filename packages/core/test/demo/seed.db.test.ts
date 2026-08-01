import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import {
  DemoAlreadySeededError,
  readDemoManifest,
  readDemoTagId,
  seedDemoData,
} from '../../src/demo/index';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
}, 240_000);

beforeEach(async () => {
  await pg.truncateWorkspaceData(workspaceId);
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
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
 * Seed běží pod APLIKAČNÍ rolí s kontextem projektu, tedy tak, jak ho volá
 * endpoint. Pod migrátorem by test prošel, i kdyby produkční kód kontext
 * nenastavoval, a chyba by se projevila až u zákazníka jako porušení
 * politiky RLS při prvním INSERTu.
 */
const seed = (now = new Date()) =>
  pg.inWorkspace(workspaceId, (tx) => seedDemoData(tx, { workspaceId, now }));

describe('seed sedí se schématem', () => {
  // Tenhle test je tu proto, že seed je jediné místo v plánu, které zapisuje
  // do devíti tabulek naráz. Když se sloupec přejmenuje nebo přibude NOT NULL,
  // spadne celý seed na prvním INSERTu a hláška ukáže jen tu první tabulku.
  // Test se neptá plánu, ale information_schema, a řekne rovnou, který
  // sloupec chybí.
  const REQUIRED: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['tags', ['workspace_id', 'name']],
    ['lists', ['workspace_id', 'name', 'description']],
    [
      'contacts',
      [
        'workspace_id',
        'email',
        'first_name',
        'last_name',
        'title_prefix',
        'first_name_key',
        'last_name_key',
        'gender',
        'gender_source',
        'first_name_vocative',
        'last_name_vocative',
        'vocative_confidence',
        'name_split_confidence',
        'greeting',
        'greeting_neutral',
        'status',
        'source',
        'source_ref',
        'locale',
        'timezone',
        'attributes',
      ],
    ],
    ['contact_tags', ['contact_id', 'tag_id', 'workspace_id']],
    [
      'list_subscriptions',
      [
        'workspace_id',
        'list_id',
        'contact_id',
        'status',
        'source',
        'subscribed_at',
        'confirmed_at',
      ],
    ],
    ['segments', ['workspace_id', 'name', 'kind', 'definition', 'definition_hash']],
    ['templates', ['workspace_id', 'name', 'kind', 'design', 'design_hash']],
    [
      'campaigns',
      [
        'workspace_id',
        'name',
        'subject',
        'template_id',
        'status',
        'started_at',
        'finished_at',
        'audience_built_at',
      ],
    ],
    [
      'campaign_stats',
      [
        'workspace_id',
        'campaign_id',
        'sent',
        'delivered',
        'opens_unique',
        'opens_unique_apple',
        'clicks_unique',
        'bounced_hard',
        'bounced_soft',
        'complained',
        'unsubscribed',
        'updated_at',
      ],
    ],
  ];

  it('každý sloupec, do kterého seed zapisuje, ve schématu existuje', async () => {
    for (const [table, columns] of REQUIRED) {
      const rows = await pg.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const actual = new Set(rows.map((r) => r.column_name));
      for (const column of columns) {
        expect(actual.has(column), `${table}.${column} ve schématu chybí`).toBe(true);
      }
    }
  });

  it('žádná z těch tabulek nemá NOT NULL sloupec bez defaultu, který seed vynechává', async () => {
    // Chytá opačnou chybu než předchozí test: sloupec, který ve schématu
    // přibyl jako povinný a seed o něm neví. Projeví se jako
    // `null value in column ... violates not-null constraint`.
    const known = new Map(REQUIRED.map(([t, c]) => [t, new Set(c)]));
    for (const [table, columns] of known) {
      const rows = await pg.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
            AND is_nullable = 'NO' AND column_default IS NULL
            AND is_generated = 'NEVER'`,
        [table],
      );
      for (const { column_name } of rows) {
        expect(
          columns.has(column_name),
          `${table}.${column_name} je povinný, ale seed ho nevyplňuje`,
        ).toBe(true);
      }
    }
  });
});

describe('seedDemoData', () => {
  it('nahraje 50 kontaktů, 3 seznamy, 4 štítky, 2 segmenty, 2 šablony a 1 kampaň', async () => {
    await seed();
    expect(await count('contacts')).toBe(50);
    expect(await count('lists')).toBe(3);
    expect(await count('tags')).toBe(4);
    expect(await count('segments')).toBe(2);
    expect(await count('templates')).toBe(2);
    expect(await count('campaigns')).toBe(1);
  });

  it('zapíše manifest se všemi identifikátory', async () => {
    await seed();
    const manifest = await pg.inWorkspace(workspaceId, (tx) => readDemoManifest(tx, workspaceId));
    expect(manifest?.contactIds).toHaveLength(50);
    expect(manifest?.campaignIds).toHaveLength(1);
    expect(manifest?.version).toBe(1);
  });

  it('všechny kontakty nesou source_ref demo-data:v1 a štítek Ukázková data', async () => {
    // ODCHYLKA OD PLÁNU: plán se ptal na `tags.slug`, ten sloupec ve schématu
    // P03 není. Štítek se pozná podle jména, které je v projektu unikátní.
    await seed();
    const rows = await pg.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM contacts c
         JOIN contact_tags ct ON ct.contact_id = c.id
         JOIN tags t ON t.id = ct.tag_id
        WHERE c.workspace_id = $1 AND c.source_ref = 'demo-data:v1' AND t.name = 'Ukázková data'`,
      [workspaceId],
    );
    expect(rows[0]!.n).toBe('50');
  });

  it('oslovení v databázi je hotové a s vokativem, ne prázdné', async () => {
    // Tohle je to jediné, kvůli čemu ukázková data existují: uživatel na nich
    // pozná, že oslovení funguje. Prázdný sloupec `greeting` by se v tabulce
    // projevil jako prázdná buňka a nikdo by nevěděl proč.
    await seed();
    const [jana] = await pg.sql<{ greeting: string; first_name_vocative: string; gender: string }>(
      `SELECT greeting, first_name_vocative, gender FROM contacts
        WHERE workspace_id = $1 AND email = 'jana.novakova@example.com'`,
      [workspaceId],
    );
    expect(jana!.greeting).toBe('Dobrý den, Jano');
    expect(jana!.first_name_vocative).toBe('Jano');
    expect(jana!.gender).toBe('female');

    const [empty] = await pg.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM contacts
        WHERE workspace_id = $1 AND (greeting = '' OR greeting IS NULL)`,
      [workspaceId],
    );
    expect(empty!.n).toBe('0');
  });

  it('kampaň má report s reálnými čísly, ne s nulami', async () => {
    // ODCHYLKA OD PLÁNU: `campaign_stats.bounced` ve schématu není, nedoručení
    // se dělí na bounced_hard a bounced_soft.
    await seed();
    const [row] = await pg.sql<{ status: string; sent: string; bounced: string }>(
      `SELECT c.status, cs.sent::text AS sent,
              (cs.bounced_hard + cs.bounced_soft)::text AS bounced
         FROM campaigns c
         JOIN campaign_stats cs ON cs.campaign_id = c.id
        WHERE c.workspace_id = $1`,
      [workspaceId],
    );
    expect(row!.status).toBe('sent');
    expect(row!.sent).toBe('50');
    expect(row!.bounced).toBe('2');
  });

  it('kampaň se vejde do existující partition, i když je první den v měsíci', async () => {
    const firstOfMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 8),
    );
    await expect(seed(firstOfMonth)).resolves.toBeDefined();
  });

  it('druhé nahrání odmítne a nezaloží nic navíc', async () => {
    await seed();
    await expect(seed()).rejects.toThrow(DemoAlreadySeededError);
    expect(await count('contacts')).toBe(50);
  });

  it('při chybě uprostřed nezůstane půlka dat, protože je to jedna transakce', async () => {
    await pg.sql('ALTER TABLE campaigns ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID');
    await pg.sql('ALTER TABLE campaigns VALIDATE CONSTRAINT tmp_fail');
    await expect(seed()).rejects.toThrow();
    expect(await count('contacts')).toBe(0);
    await pg.sql('ALTER TABLE campaigns DROP CONSTRAINT tmp_fail');
  });

  it('vrátí identifikátor štítku, na kterém stojí hromadný výběr v tabulce', async () => {
    // Tabulka kontaktů filtruje podle `tag_id`, ne podle jména štítku, takže
    // bez tohohle identifikátoru by odkaz z pruhu ukázkových dat vedl na
    // nefiltrovaný seznam a slib „vyberte je hromadně" by neplatil.
    await seed();
    const tagId = await pg.inWorkspace(workspaceId, (tx) => readDemoTagId(tx, workspaceId));
    expect(tagId).not.toBeNull();
    const rows = await pg.sql<{ name: string; n: string }>(
      `SELECT t.name, count(ct.contact_id)::text AS n FROM tags t
         LEFT JOIN contact_tags ct ON ct.tag_id = t.id
        WHERE t.id = $1 GROUP BY t.name`,
      [tagId],
    );
    expect(rows[0]!.name).toBe('Ukázková data');
    expect(rows[0]!.n).toBe('50');
  });

  it('bez ukázkových dat žádný štítek nevrací', async () => {
    expect(await pg.inWorkspace(workspaceId, (tx) => readDemoTagId(tx, workspaceId))).toBeNull();
  });

  it('zapíše do auditu akci demo_data.seeded', async () => {
    await seed();
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'demo_data.seeded' AND workspace_id = $1",
      [workspaceId],
    );
    expect(rows.length).toBe(1);
  });
});
