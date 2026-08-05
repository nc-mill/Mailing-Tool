// packages/db/test/contract-sql.test.ts
//
// Obdoba scénáře OB-00 uvnitř packages/db. Vezme každý normativní dotaz
// kontraktu, spustí ho proti čerstvě zmigrované databázi a ověří JEDINOU věc:
// že neskončí chybou. Prázdný výsledek je úspěch.
//
// Dotazy se NAČÍTAJÍ ze souborů, které vlastní P02, ne opisují do testu.
// Ruční opis dokazuje, že projde opis, ne kontrakt.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, type RoleName, startHarness } from './helpers/container';
import { ensureUpcomingPartitions } from '../src/partitions';
import { expectPgError } from './helpers/errors';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // Šablona se migruje s ensurePartitions: false, ale dotazy aplikační strany
  // do partitionovaných tabulek skutečně zapisují.
  await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
}, 120_000);
afterAll(async () => {
  await h.stop();
});

/** Soubory vlastní P02. Tenhle plán je jen čte, nikdy nemění. */
const CONTRACT_SQL_DIR = fileURLToPath(
  new URL('../../contracts/fixtures/outbox/sql/', import.meta.url),
);

type ContractQuery = {
  name: string;
  sql: string;
  role: RoleName;
  paramTypes: string[];
  args: string;
};

/**
 * Hlavičku souboru definuje P02 a má tři direktivy:
 *   -- role: sender
 *   -- params: text, int, int, uuid
 *   -- args: 'mlain-ws-7f3a', 100, 300, '0192...'
 *
 * Bez explicitních typů skončí PREPARE u výrazu `WHEN $1 = 'retry'` chybou
 * "could not determine data type of parameter $1", protože obě strany
 * porovnání jsou neznámého typu.
 */
function loadContractQueries(): ContractQuery[] {
  if (!existsSync(CONTRACT_SQL_DIR)) return [];
  const files = readdirSync(CONTRACT_SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(CONTRACT_SQL_DIR, file), 'utf8');
    // POZOR na `\s` v těchhle třech regexech: zahrnuje konec řádku, takže
    // `\s*(.*)$` u PRÁZDNÉ hlavičky přeskočí na další řádek a sebere jeho obsah.
    // U `-- params:` bez hodnoty to znamenalo, že se jako typ parametru vzalo
    // `-- args:` a vznikl příkaz `PREPARE jmeno (-- args:) AS SELECT ...`,
    // kde komentář sežral zbytek řádku. Projevilo se to jako „syntax error
    // at or near FROM", tedy chybou, která ukazuje na SQL, přestože SQL bylo
    // v pořádku. Devět z jedenácti dotazů to zamaskovalo tím, že parametry mají.
    // Proto `[ \t]*`, které konec řádku nepřekročí.
    const role = raw.match(/^--[ \t]*role:[ \t]*(.*)$/m)?.[1]?.trim() ?? 'sender';
    const params = raw.match(/^--[ \t]*params:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
    const args = raw.match(/^--[ \t]*args:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
    const sql = raw
      .split('\n')
      .filter((line) => !/^--[ \t]*(role|params|args):/.test(line))
      .join('\n')
      .trim()
      .replace(/;\s*$/, '');
    return {
      name: file.replace(/\.sql$/, ''),
      sql,
      // Direktiva `role` NENÍ dekorace: 09-materialize-insert má `role: app`
      // a pod senderem by skončil na permission denied, tedy na chybě, která
      // s platností kontraktního SQL nemá nic společného.
      role: (role === 'app' ? 'mlain_app' : 'mlain_sender') as RoleName,
      paramTypes: params ? params.split(',').map((t) => t.trim()) : [],
      args,
    };
  });
}

const CONTRACT_QUERIES = loadContractQueries();

describe('kontraktní SQL projde parserem i plánovačem (obdoba OB-00)', () => {
  it('načetlo se jedenáct normativních dotazů kontraktu', () => {
    // Kdyby se adresář přejmenoval nebo vyprázdnil, prošel by test „všechny
    // dotazy jsou v pořádku" nad prázdným seznamem. Prázdná sada není úspěch.
    expect(
      CONTRACT_QUERIES.length,
      `v ${CONTRACT_SQL_DIR} není jedenáct dotazů; vlastní je P02`,
    ).toBe(11);
  });

  for (const query of CONTRACT_QUERIES) {
    // Běží pod rolí z hlavičky, tedy pod tou, která dotaz spouští v provozu.
    // Spuštění všeho pod migrátorem by zamaskovalo chybějící politiku
    // sender_bypass.
    //
    // PREPARE projde parserem a analyzátorem, EXPLAIN EXECUTE navíc spustí
    // plánovač a nic nevykoná. U UPDATE je to jediný bezpečný způsob, jak
    // dotaz ověřit proti databázi s daty.
    it(query.name, async () => {
      const client = await h.as(query.role).connect();
      const stmt = `ob_${query.name.replace(/[^a-z0-9]/gi, '_')}`;
      try {
        const types = query.paramTypes.length ? `(${query.paramTypes.join(', ')})` : '';
        await client.query(`PREPARE ${stmt} ${types} AS ${query.sql}`);
        await expect(
          client.query(`EXPLAIN (COSTS OFF) EXECUTE ${stmt}${query.args ? `(${query.args})` : ''}`),
        ).resolves.toBeDefined();
      } finally {
        await client.query(`DEALLOCATE ALL`).catch(() => undefined);
        client.release();
      }
    });
  }
});

describe('normativní dotazy aplikační strany', () => {
  it('materializace publika s ON CONFLICT nad třemi sloupci indexu I JEHO PREDIKÁTEM', async () => {
    // Uvedení jen dvou sloupců není tichá chyba, ale tvrdý ERROR
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification", a materializace by neproběhla vůbec.
    //
    // Od migrace 0010_test_send_unblock nestačí ani všechny tři sloupce:
    // `uq_messages__campaign_contact` je od ní ČÁSTEČNÝ (`WHERE kind =
    // 'campaign'`) a částečný index Postgres jako arbitra neodvodí, dokud se
    // týž predikát neuvede i v ON CONFLICT. Tenhle test tu chybu držel od
    // migrace 0010 a padal, přestože produkční dotaz
    // (`campaigns/repo/outbox.ts`) predikát celou dobu uvádí správně.
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email,
                             render_data, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'x@example.test', '{}'::jsonb, $4
       WHERE false
       ON CONFLICT (campaign_id, contact_id, created_at) WHERE kind = 'campaign' DO NOTHING`,
        [
          '01930000-0000-7000-8000-000000000003',
          '01930000-0000-7000-8000-000000000001',
          '01930000-0000-7000-8000-000000000004',
          '2026-08-01T00:00:00Z',
        ],
      ),
    ).resolves.toBeDefined();
  });

  it('ON CONFLICT jen nad dvěma sloupci naopak MUSÍ selhat', async () => {
    await expectPgError(
      () =>
        h.as('mlain_migrator').query(
          `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'x@example.test', $4
       WHERE false
       ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
          [
            '01930000-0000-7000-8000-000000000003',
            '01930000-0000-7000-8000-000000000001',
            '01930000-0000-7000-8000-000000000004',
            '2026-08-01T00:00:00Z',
          ],
        ),
      '42P10',
      /no unique or exclusion constraint/i,
      'dvousloupcový ON CONFLICT prošel:',
    );
  });

  it('dedup příchozích událostí přes NOT EXISTS nad prefixem indexu', async () => {
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO provider_event_receipts (workspace_id, provider_id, dedup_key,
                                            sns_message_id, event_type, raw, received_at, status)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7, 'received'
        WHERE NOT EXISTS (
          SELECT 1 FROM provider_event_receipts
           WHERE workspace_id = $1 AND dedup_key = $3
             AND received_at >= date_trunc('month', $7::timestamptz))
       ON CONFLICT (workspace_id, dedup_key, received_at) DO NOTHING
       RETURNING id`,
        [
          '01930000-0000-7000-8000-000000000003',
          '01930000-0000-7000-8000-000000000005',
          'sns:abc',
          'abc',
          'Delivery',
          '{}',
          new Date().toISOString(),
        ],
      ),
    ).resolves.toBeDefined();
  });

  it('veto retenčního jobu: oba dotazy z konvence 2.1 jsou spustitelné', async () => {
    for (const query of [
      `SELECT 1 FROM campaigns
        WHERE audience_built_at >= $1 AND audience_built_at < $2
          AND status IN ('queueing','sending','paused') LIMIT 1`,
      `SELECT 1 FROM messages
        WHERE created_at >= $1 AND created_at < $2
          AND status IN ('pending','claimed') LIMIT 1`,
    ]) {
      await expect(
        h.as('mlain_migrator').query(query, ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z']),
      ).resolves.toBeDefined();
    }
  });

  it('dotaz na web_events podle occurred_at nese i podmínku na received_at', async () => {
    // Bez druhého řádku se prohledají VŠECHNY partition. Je to přesně ta chyba,
    // před kterou konvence varuje u dvousložkových klíčů, jen o úroveň výš.
    await expect(
      h.as('mlain_migrator').query(
        `SELECT count(*) FROM web_events
        WHERE occurred_at >= $1 AND occurred_at < $2
          AND received_at >= $1 AND received_at < $2::timestamptz + interval '7 days'`,
        ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'],
      ),
    ).resolves.toBeDefined();
  });
});
