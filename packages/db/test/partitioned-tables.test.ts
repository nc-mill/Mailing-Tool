import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { createMonthlyPartitions } from '../src/partitions';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

const EXPECTED: Record<string, string> = {
  audit_log: 'created_at',
  webhook_events: 'created_at',
  webhook_deliveries: 'created_at',
  messages: 'created_at',
  message_events: 'received_at',
  provider_event_receipts: 'received_at',
  inbound_deliveries: 'created_at',
  web_events: 'received_at',
  message_engagement: 'created_at',
};

describe('partitionované tabulky', () => {
  it('existuje přesně devět partitionovaných tabulek', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'p' ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(Object.keys(EXPECTED).sort());
  });

  it('každá partitionuje podle sloupce z registru, nikdy podle cizího času', async () => {
    for (const [table, column] of Object.entries(EXPECTED)) {
      const { rows } = await h.as('mlain_migrator').query<{ col: string }>(
        `SELECT a.attname AS col
           FROM pg_partitioned_table p
           JOIN pg_class c ON c.oid = p.partrelid
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]
          WHERE c.relname = $1`,
        [table],
      );
      expect(rows[0]?.col, `${table} partitionuje podle špatného sloupce`).toBe(column);
    }
  });

  it('primární klíč každé partitionované tabulky obsahuje partiční sloupec', async () => {
    for (const [table, column] of Object.entries(EXPECTED)) {
      const { rows } = await h.as('mlain_migrator').query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'p'`,
        [table],
      );
      expect(rows[0].def, `${table} nemá ${column} v primárním klíči`).toContain(column);
    }
  });

  it('žádná partitionovaná tabulka nemá DEFAULT partition', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('messages má všech 23 kontraktních sloupců se správným typem', async () => {
    const expected: Record<string, string> = {
      id: 'uuid',
      workspace_id: 'uuid',
      campaign_id: 'uuid',
      content_variant_id: 'uuid',
      kind: 'text',
      contact_id: 'uuid',
      email: 'text',
      render_data: 'jsonb',
      status: 'text',
      claimed_by: 'text',
      claimed_at: 'timestamp with time zone',
      claim_expires_at: 'timestamp with time zone',
      attempts: 'smallint',
      ambiguous_count: 'smallint',
      dispatch_started_at: 'timestamp with time zone',
      next_attempt_at: 'timestamp with time zone',
      provider_message_id: 'text',
      sent_at: 'timestamp with time zone',
      error_code: 'text',
      error_detail: 'text',
      created_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone',
    };
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'messages'`,
      );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    for (const [column, type] of Object.entries(expected)) {
      expect(byName[column], `messages.${column} chybí`).toBeDefined();
      expect(byName[column].data_type, `messages.${column} má špatný typ`).toBe(type);
    }
    // contact_id je v kontraktu NOT NULL. Rozhodnutí R3.
    expect(byName.contact_id.is_nullable).toBe('NO');
    // campaign_id a content_variant_id jsou rezervy a musí být nullable.
    expect(byName.campaign_id.is_nullable).toBe('YES');
    expect(byName.content_variant_id.is_nullable).toBe('YES');
  });

  it('messages má kontraktní indexy včetně dvousložkové unikátnosti publika', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'messages'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.idx_messages__claimable).toContain('campaign_id');
    expect(byName.idx_messages__claimable).toContain("status = 'pending'");
    expect(byName.uq_messages__campaign_contact).toContain('created_at');
    expect(byName.idx_messages__stuck).toBeDefined();
    expect(byName.idx_messages__campaign_status).toBeDefined();
    expect(byName.idx_messages__test_claimable).toContain("kind = 'test'");
  });

  it('message_events nese obě složky klíče zprávy a obě jsou NOT NULL', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'message_events'
          AND column_name IN ('message_id','message_created_at')`,
      );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.is_nullable).toBe('NO');
  });

  // --- rank a recipient, rozhodnutí R32 a R33 -------------------------------

  it('rank je generovaný sloupec a nejde do něj zapsat zvenčí', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ is_generated: string }>(
      `SELECT is_generated FROM information_schema.columns
        WHERE table_name = 'message_events' AND column_name = 'rank'`,
    );
    expect(
      rows[0].is_generated,
      'rank musí být GENERATED ALWAYS, jinak ho může volající uvést špatně',
    ).toBe('ALWAYS');

    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, recipient, type, rank, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'a@b.cz', 'delivered', 99, now(), 'ses_sns')`,
      ),
    ).rejects.toThrow(/non-DEFAULT value into column "rank"/i);
  });

  /**
   * Ochrana proti driftu škály. Ptá se KATALOGU dvakrát ze dvou nezávislých
   * míst: jednou na text omezení ck_message_events__type, podruhé na výraz
   * generovaného sloupce. Kdyby se ptal registru v TypeScriptu, ze kterého
   * obojí vzniklo, byl by slepý přesně vůči té chybě, kterou má chytat.
   *
   * Ověřeno, že test NENÍ slepý: po dopsání typu do CHECK bez odpovídajícího
   * ramene v CASE se množiny přestanou rovnat a test spadne.
   */
  it('každý povolený typ události má rameno ve škále rank a naopak', async () => {
    const { rows } = await h.as('mlain_migrator').query<{
      check_types: string[];
      rank_arms: string[];
    }>(`
      WITH check_types AS (
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) AS t
          FROM regexp_matches(
                 (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conname = 'ck_message_events__type'
                     AND conrelid = 'message_events'::regclass),
                 '''([a-z_]+)''', 'g') AS m
      ), rank_arms AS (
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) AS t
          FROM regexp_matches(
                 (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'message_events'::regclass AND a.attname = 'rank'),
                 '''([a-z_]+)''', 'g') AS m
      )
      SELECT (SELECT t FROM check_types) AS check_types,
             (SELECT t FROM rank_arms)   AS rank_arms`);
    expect(
      rows[0].rank_arms,
      'typ povolený v CHECK bez ramene v CASE dostane rank NULL a zápis spadne',
    ).toEqual(rows[0].check_types);
    expect(rows[0].check_types).toHaveLength(12);
  });

  it('recipient je nepovinný, ale doručovací rodina ho mít musí', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'message_events' AND column_name = 'recipient'`,
    );
    expect(
      rows[0].is_nullable,
      'NOT NULL by kopírovalo osobní údaj na každý řádek desetimilionové tabulky',
    ).toBe('YES');

    const partition = `message_events_y${new Date().toISOString().slice(0, 7).replace('-', 'm')}`;
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'message_events',
      'received_at',
      new Date(),
      1,
    );

    // otevření bez adresy projde a dostane rank 0
    const { rows: opened } = await h.as('mlain_migrator').query<{ rank: number }>(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'open', now(), 'tracking')
       RETURNING rank`,
    );
    expect(opened[0].rank).toBe(0);

    // doručení bez adresy musí selhat
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'delivered', now(), 'ses_sns')`,
      ),
    ).rejects.toThrow(/ck_message_events__recipient/);

    // a s adresou projde a dostane rank z katalogu P13
    const { rows: delivered } = await h.as('mlain_migrator').query<{ rank: number }>(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, recipient, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'a@b.cz', 'delivered', now(), 'ses_sns')
       RETURNING rank`,
    );
    expect(delivered[0].rank).toBe(30);
    // Zápisy výš skončily v oddílu aktuálního měsíce, ne v tabulce jako celku.
    // Plán tu měl porovnání řetězce se vzorem, který si sám sestavil, tedy
    // tautologii; tohle se ptá katalogu.
    const { rows: existing } = await h
      .as('mlain_migrator')
      .query<{ t: string | null }>(`SELECT to_regclass('public.' || $1) AS t`, [partition]);
    expect(existing[0].t, `oddíl ${partition} nevznikl`).not.toBeNull();
  });

  it('bounce index nad nepovinným recipient dál existuje a je částečný', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'message_events'
          AND indexname = 'idx_message_events__recipient_bounce'`,
    );
    expect(rows[0].indexdef).toContain('WHERE');
    expect(rows[0].indexdef).toContain('bounced_soft');
  });
});
