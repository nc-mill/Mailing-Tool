import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import {
  PARTITIONED_REFERENCES,
  PARTITIONED_TABLES,
  UNIQUE_INDEX_EXCEPTIONS,
  createIndexConcurrentlyOnPartitioned,
  createMonthlyPartitions,
  dropPartitionsBefore,
  ensurePartitionsForRange,
  ensureUpcomingPartitions,
  parseBounds,
  partitionName,
  planPartitionsBefore,
} from '../src/partitions';
import { seedTwoWorkspaces } from './helpers/fixtures';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('registr partitionovaných tabulek', () => {
  it('obsahuje devět tabulek a u každé partiční sloupec', () => {
    expect(PARTITIONED_TABLES).toHaveLength(9);
    const byName = Object.fromEntries(PARTITIONED_TABLES.map((t) => [t.table, t.column]));
    expect(byName.messages).toBe('created_at');
    expect(byName.message_events).toBe('received_at');
    expect(byName.provider_event_receipts).toBe('received_at');
    expect(byName.web_events).toBe('received_at');
    expect(byName.message_engagement).toBe('created_at');
    expect(byName.inbound_deliveries).toBe('created_at');
    expect(byName.audit_log).toBe('created_at');
  });

  it('registr sedí na skutečný stav databáze', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string; col: string }>(
      `SELECT c.relname, a.attname AS col
         FROM pg_partitioned_table p
         JOIN pg_class c ON c.oid = p.partrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]`,
    );
    const actual = Object.fromEntries(rows.map((r) => [r.relname, r.col]));
    for (const { table, column } of PARTITIONED_TABLES) {
      expect(actual[table], `${table} chybí nebo partitionuje jinak`).toBe(column);
    }
    expect(Object.keys(actual)).toHaveLength(PARTITIONED_TABLES.length);
  });

  it('každý odkaz na partitionovanou tabulku nese obě složky klíče', async () => {
    // Test se řídí REGISTREM, ne jmenovitým výčtem. Dokud kontroloval jen
    // message_events, chyběla druhá složka u webhook_deliveries.event_id
    // i u inbound_dedup.delivery_id a nikdo si toho nevšiml. Načtení payloadu
    // při opakovaném pokusu tedy procházelo všechny oddíly.
    for (const ref of PARTITIONED_REFERENCES) {
      const { rows } = await h.as('mlain_migrator').query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [ref.from, ref.secondColumn],
      );
      expect(
        rows,
        `${ref.from}.${ref.secondColumn} chybí, odkaz na ${ref.to} ` +
          `by prohledal všechny oddíly`,
      ).toHaveLength(1);
      expect(
        rows[0].is_nullable,
        `${ref.from}.${ref.secondColumn} je nullable, klíč by byl neúplný`,
      ).toBe(ref.nullable ? 'YES' : 'NO');
    }
  });

  it('žádný unikátní index partitionované tabulky nestojí na sloupci s DEFAULT now()', async () => {
    // Katalogová kontrola rozhodnutí R22. Unikátní index, jehož složkou je
    // now(), NEGARANTUJE NIC: dva zápisy téže věci v různý čas projdou oba.
    // Výjimky jsou pojmenované a odůvodněné v registru; cokoli mimo něj
    // je nový výskyt téže chyby.
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ tabulka: string; idx: string; sloupec: string }>(
        `SELECT c.relname AS tabulka, i.relname AS idx, a.attname AS sloupec
           FROM pg_index x
           JOIN pg_class i ON i.oid = x.indexrelid
           JOIN pg_class c ON c.oid = x.indrelid
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (x.indkey)
           JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE c.relkind = 'p' AND x.indisunique AND NOT x.indisprimary
            AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%now()%'
          ORDER BY 2`,
      );
    const nezname = rows
      .map((r) => r.idx)
      .filter((idx) => !UNIQUE_INDEX_EXCEPTIONS.some((e) => e.index === idx));
    expect(
      nezname,
      'unikátní index nad sloupcem s DEFAULT now() bez evidované ' +
        'výjimky slibuje ochranu, kterou nemá',
    ).toEqual([]);

    // A opačně: evidovaná výjimka, která zmizela, se má z registru smazat,
    // jinak registr přestane popisovat skutečnost.
    for (const vyjimka of UNIQUE_INDEX_EXCEPTIONS) {
      expect(
        rows.map((r) => r.idx),
        `výjimka ${vyjimka.index} už neexistuje`,
      ).toContain(vyjimka.index);
    }
  });
});

describe('zakládání partition', () => {
  it('název partition má tvar <tabulka>_yYYYYmMM', () => {
    expect(partitionName('web_events', new Date('2026-08-15T00:00:00Z'))).toBe(
      'web_events_y2026m08',
    );
    expect(partitionName('messages', new Date('2027-01-01T00:00:00Z'))).toBe('messages_y2027m01');
  });

  it('založí partition na aktuální a další tři měsíce pro všech devět tabulek', async () => {
    await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE c.relname LIKE '%\\_y2026m%' OR c.relname LIKE '%\\_y2027m%'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(9 * 4);
  });

  it('je idempotentní, druhý běh nezaloží nic navíc a nespadne', async () => {
    const count = async () => {
      const { rows } = await h
        .as('mlain_migrator')
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_inherits`);
      return rows[0].n;
    };
    const before = await count();
    await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    expect(await count()).toBe(before);
  });

  it('partition messages dostane fillfactor a agresivnější autovacuum', async () => {
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'messages',
      'created_at',
      new Date('2026-08-01T00:00:00Z'),
      1,
      {
        fillfactor: 70,
        autovacuumVacuumScaleFactor: 0.02,
        autovacuumVacuumThreshold: 1000,
        autovacuumAnalyzeScaleFactor: 0.02,
        autovacuumVacuumCostDelay: 0,
      },
    );
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ reloptions: string[] }>(
        `SELECT reloptions FROM pg_class WHERE relname = 'messages_y2026m08'`,
      );
    expect(rows[0].reloptions.join(',')).toContain('fillfactor=70');
    expect(rows[0].reloptions.join(',')).toContain('autovacuum_vacuum_scale_factor=0.02');
  });

  it('nová partition NENÍ přímo přístupná žádné roli kromě migrátora (R20)', async () => {
    // Původní znění kritéria AK-20.2 znělo opačně („nová partition je pro
    // sender čitelná") a bylo jediným důvodem existence copyGrantsFromParent.
    // Sender ale žádný oddíl jménem nečte, zato kopie grantů obcházela RLS:
    // oddíl nedědí relrowsecurity ani politiky, takže s granty se z něj daly
    // číst řádky všech projektů.
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'messages',
      'created_at',
      new Date('2027-06-01T00:00:00Z'),
      1,
    );

    for (const role of ['mlain_app', 'mlain_sender'] as const) {
      await expect(
        h.as(role).query('SELECT count(*) FROM messages_y2027m06'),
        `${role} se dostane přímo na oddíl`,
      ).rejects.toThrow(/permission denied/i);
    }
    // Přístup přes rodiče přitom funguje dál. Práva se kontrolují na relaci,
    // na kterou dotaz míří, takže kopie grantů na oddíly není k ničemu potřeba.
    await expect(
      h.as('mlain_sender').query('SELECT count(*) FROM messages'),
    ).resolves.toBeDefined();
  });

  it('žádný oddíl nemá ACL záznam, a je to zjištěné z katalogu', async () => {
    // Kontrola se NEPTÁ seznamu tabulek v kódu, ale pg_class. Pevný seznam
    // by se se schématem tiše rozešel, protože oddíly vznikají za běhu.
    await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    const { rows } = await h.as('mlain_migrator').query<{ relname: string; acl: string }>(
      `SELECT c.relname, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relispartition AND c.relacl IS NOT NULL`,
    );
    expect(rows.map((r) => `${r.relname}: ${r.acl}`)).toEqual([]);
  });

  it('hranice oddílu je v UTC bez ohledu na časovou zónu spojení', async () => {
    // FOR VALUES FROM ('2026-08-01') se přetypuje podle TimeZone spojení.
    // Oddíl založený pod Europe/Prague začíná v 2026-07-31 22:00+00 a mezi
    // ním a dalším měsícem založeným pod UTC zůstane dvouhodinová DÍRA.
    // Zápis do ní tvrdě selže, protože výchozí oddíl se nezakládá, a ztracené
    // řádky jsou právě ty, které se ztratit nesmí: odrazy a stížnosti.
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query(`SET TimeZone = 'Europe/Prague'`);
      await createMonthlyPartitions(
        client,
        'web_events',
        'received_at',
        new Date('2027-03-01T00:00:00Z'),
        1,
      );
    } finally {
      await client.query('RESET TimeZone').catch(() => undefined);
      client.release();
    }
    // Hranice se ČTE z jiného spojení, které běží v UTC. pg_get_expr vypisuje
    // timestamptz v časové zóně ČTOUCÍ session, takže čtení pod týmž pražským
    // spojením by vrátilo '2027-03-01 01:00:00+01' i u správně založeného
    // oddílu a test by hlásil chybu, která tam není. Ověřuje se uložený
    // OKAMŽIK, ne jeho vypsaný tvar.
    const { rows } = await h.as('mlain_migrator').query<{ bound: string }>(
      `SELECT pg_get_expr(relpartbound, oid) AS bound
         FROM pg_class WHERE relname = 'web_events_y2027m03'`,
    );
    expect(rows[0].bound).toContain(`'2027-03-01 00:00:00+00'`);
    expect(rows[0].bound).toContain(`'2027-04-01 00:00:00+00'`);
  });

  it('doplní chybějící oddíly pro zpětný rozsah, kvůli dávkovému importu historie', async () => {
    const created = await ensurePartitionsForRange(
      h.as('mlain_migrator'),
      'web_events',
      'received_at',
      new Date('2025-11-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(created).toEqual(['web_events_y2025m11', 'web_events_y2025m12', 'web_events_y2026m01']);
  });

  it('výchozí partition se nezakládá nikdy', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
        WHERE pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('odpojování partition', () => {
  it('bez veto predikátu odmítne cokoliv odpojit', async () => {
    await expect(
      dropPartitionsBefore(
        h.as('mlain_migrator'),
        'messages',
        'created_at',
        new Date('2027-01-01T00:00:00Z'),
        undefined as never,
      ),
    ).rejects.toThrow(/veto/i);
  });

  it('třífázový index nad partitionovanou tabulkou vznikne platný', async () => {
    // Jediný povolený postup pro index nad tabulkou s daty. Prosté CREATE INDEX
    // na rodiči zamkne tabulku i všechny oddíly na dobu stavby, takže první
    // upgradová migrace nad velkou instalací skončí na lock_timeout.
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'web_events',
      'received_at',
      new Date('2027-09-01T00:00:00Z'),
      2,
    );
    await createIndexConcurrentlyOnPartitioned(h.as('mlain_migrator'), {
      parent: 'web_events',
      indexName: 'idx_web_events__probe_session',
      definition: '(workspace_id, session_id)',
    });
    const { rows } = await h.as('mlain_migrator').query<{ indisvalid: boolean }>(
      `SELECT indisvalid FROM pg_index
        WHERE indexrelid = 'idx_web_events__probe_session'::regclass`,
    );
    expect(rows[0].indisvalid, 'index rodiče zůstal neplatný, chybí ATTACH').toBe(true);
  });

  it('veto zabrání odpojení partition, ve které leží nedoručená zpráva', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'messages',
      'created_at',
      new Date('2026-09-01T00:00:00Z'),
      1,
    );
    await h.as('mlain_migrator').query(
      `INSERT INTO messages (workspace_id, contact_id, email, status, created_at)
       VALUES ($1, $2, 'a@example.test', 'pending', '2026-09-15T00:00:00Z')`,
      [ws.workspaceA, ws.contactInA],
    );

    const dropped = await dropPartitionsBefore(
      h.as('mlain_migrator'),
      'messages',
      'created_at',
      new Date('2026-10-01T00:00:00Z'),
      async (client, from, to) => {
        const { rows } = await client.query(
          `SELECT 1 FROM messages
            WHERE created_at >= $1 AND created_at < $2
              AND status IN ('pending','claimed') LIMIT 1`,
          [from, to],
        );
        // true = smí se odpojit, jinak DŮVOD. Prosté `false` tu bylo, dokud
        // výsledek nikdo nečetl; režim nanečisto musí umět říct, proč nechal.
        return rows.length === 0 ? true : { keep: 'leží v ní nedoručená zpráva' };
      },
    );
    expect(dropped).not.toContain('messages_y2026m09');
    const { rows } = await h
      .as('mlain_migrator')
      .query(`SELECT to_regclass('public.messages_y2026m09') AS t`);
    expect(rows[0].t).not.toBeNull();
  });

  it('plán vrátí u ponechané partition důvod, aby šlo vysvětlit prázdný úklid', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'messages',
      'created_at',
      new Date('2026-07-01T00:00:00Z'),
      1,
    );
    await h.as('mlain_migrator').query(
      `INSERT INTO messages (workspace_id, contact_id, email, status, created_at)
       VALUES ($1, $2, 'b@example.test', 'pending', '2026-07-15T00:00:00Z')`,
      [ws.workspaceA, ws.contactInA],
    );

    const plan = await planPartitionsBefore(
      h.as('mlain_migrator'),
      'messages',
      new Date('2026-08-01T00:00:00Z'),
      async () => ({ keep: 'zkušební důvod' }),
    );
    const july = plan.find((d) => d.partition === 'messages_y2026m07');
    expect(july?.drop).toBe(false);
    expect(july?.keepReason).toBe('zkušební důvod');
    // Plán NESMÍ nic změnit. Kdyby režim nanečisto sahal na data, nebyl by to
    // režim nanečisto.
    const { rows } = await h
      .as('mlain_migrator')
      .query(`SELECT to_regclass('public.messages_y2026m07') AS t`);
    expect(rows[0].t).not.toBeNull();
  });

  it('hranice se čte z katalogu, ne ze jména partition', async () => {
    // Jméno oddílu je jen řetězec, který někdo zvolil. Oddíl pojmenovaný jako
    // srpen 2020, ale s hranicemi v roce 2030, se NESMÍ zahodit jen proto, že
    // jméno vypadá staře. Dřívější verze se ptala regexem jména a tenhle oddíl
    // by smazala i s daty.
    await h.as('mlain_migrator').query(
      `CREATE TABLE web_events_y2020m08 PARTITION OF web_events
         FOR VALUES FROM (TIMESTAMPTZ '2030-01-01 00:00:00+00')
                      TO (TIMESTAMPTZ '2030-02-01 00:00:00+00')`,
    );
    try {
      const dropped = await dropPartitionsBefore(
        h.as('mlain_migrator'),
        'web_events',
        'received_at',
        new Date('2026-01-01T00:00:00Z'),
        async () => true,
      );
      expect(dropped).not.toContain('web_events_y2020m08');
    } finally {
      await h
        .as('mlain_migrator')
        .query(`ALTER TABLE web_events DETACH PARTITION web_events_y2020m08`);
      await h.as('mlain_migrator').query(`DROP TABLE IF EXISTS web_events_y2020m08`);
    }
  });
});

describe('parseBounds', () => {
  it('přečte obě hranice v doslovném tvaru, jaký tiskne Postgres', () => {
    // Řetězec je zkopírovaný z `pg_get_expr(relpartbound)` na běžící databázi.
    // Offset `+00` bez minut NENÍ platný ISO 8601 a `new Date()` na něm vrací
    // Invalid Date. Dokud se nenormalizoval, hlásil úklid u KAŽDÉHO oddílu
    // „hranice se nedá přečíst z katalogu" a neuklidil nikdy nic.
    const bounds = parseBounds(
      "FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00')",
    );
    expect(bounds?.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(bounds?.to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('zvládne i offset s minutami a se Z', () => {
    expect(
      parseBounds(
        "FOR VALUES FROM ('2026-08-01 00:00:00+02:00') TO ('2026-09-01 00:00:00Z')",
      )?.from.toISOString(),
    ).toBe('2026-07-31T22:00:00.000Z');
  });

  it.each([
    ['DEFAULT'],
    ["FOR VALUES FROM (MINVALUE) TO ('2026-09-01 00:00:00+00')"],
    ["FOR VALUES FROM ('2026-08-01 00:00:00+00') TO (MAXVALUE)"],
    ["FOR VALUES IN ('a', 'b')"],
    ['FOR VALUES WITH (modulus 4, remainder 0)'],
  ])('u %s vrátí null, aby se oddíl nechal', (bound) => {
    // null znamená „hranice není jistá, oddíl nech". Kdyby se to spletlo
    // s nulou, spadl by výchozí oddíl do roku 1970 a zahodil by se první.
    expect(parseBounds(bound)).toBeNull();
  });
});
