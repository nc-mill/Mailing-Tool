import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('migrace 0001, jádro schématu', () => {
  it('vzniklo 67 nepartitionovaných tabulek', async () => {
    // relispartition = false je nutné: partition samotné jsou taky relkind 'r'
    // a od úkolu 17 je runner zakládá na čtyři měsíce dopředu, takže bez téhle
    // podmínky by test po přidání partitioningu začal počítat desítky navíc.
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false`,
    );
    // 66 do migrace 0012, od 0013 navíc `sender_identities`.
    expect(rows[0].n).toBe(67);
  });

  it('contacts.email je citext a email_domain je generovaný sloupec', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ column_name: string; data_type: string; is_generated: string }>(
        `SELECT column_name, data_type, is_generated
         FROM information_schema.columns
        WHERE table_name = 'contacts' AND column_name IN ('email','email_domain','search_text')
        ORDER BY column_name`,
      );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.email.data_type).toBe('USER-DEFINED');
    expect(byName.email_domain.is_generated).toBe('ALWAYS');
    expect(byName.search_text.is_generated).toBe('ALWAYS');
  });

  it('campaigns.pause_reason je jsonb, ne text (kontraktní sloupec)', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'pause_reason'`,
    );
    expect(rows[0].data_type).toBe('jsonb');
  });

  it('částečné unikátní indexy nad měkce mazanými tabulkami existují', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef LIKE '%WHERE (deleted_at IS NULL)%'
        ORDER BY 1`,
    );
    const names = rows.map((r) => r.indexname);
    for (const expected of [
      'uq_users__email',
      'uq_workspaces__slug',
      'uq_contacts__workspace_email',
      'uq_lists__workspace_name',
      'uq_segments__workspace_name',
      'uq_templates__workspace_name',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('žádná tabulka nepoužívá nativní enum typ', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e' AND n.nspname = 'public'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('žádná tabulka nemá trigger', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`);
    expect(rows[0].n).toBe(0);
  });

  it('otisky v email_fingerprints projdou tam i zpět přes skutečný ovladač', async () => {
    // Tvar hodnoty na drátě je vlastnost ovladače, ne našeho typu, takže tohle
    // je jediné místo, kde se dá ověřit. Kdyby se rozešly, otisky by se tiše
    // znehodnotily, kontrola suppression by přestala platit a vymazaný člověk
    // by dostal e-mail, aniž by cokoli selhalo.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const otisky = [Buffer.from('9f86d081884c7d65', 'hex'), Buffer.from('0d1b48', 'hex')];
    await h
      .as('mlain_migrator')
      .query(`UPDATE contacts SET email_fingerprints = $2 WHERE id = $1`, [ws.contactInA, otisky]);

    const { rows } = await h
      .as('mlain_migrator')
      .query<{ f: Buffer[] }>('SELECT email_fingerprints AS f FROM contacts WHERE id = $1', [
        ws.contactInA,
      ]);
    expect(Array.isArray(rows[0].f)).toBe(true);
    expect(rows[0].f).toHaveLength(2);
    expect(Buffer.isBuffer(rows[0].f[0])).toBe(true);
    expect(rows[0].f[0].equals(otisky[0])).toBe(true);
    expect(rows[0].f[1].equals(otisky[1])).toBe(true);

    // A že se pole dá i vyhledat, protože přesně to dělá kontrola suppression.
    const { rows: found } = await h
      .as('mlain_migrator')
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM contacts WHERE email_fingerprints && $1::bytea[]`,
        [[otisky[1]]],
      );
    expect(found[0].n).toBe(1);
  });

  it('migrace 0001 nezakládá žádnou z devíti partitionovaných tabulek', () => {
    // Tichá varianta téhle chyby je horší než hlasitá: kdyby drizzle-kit
    // partitionovanou tabulku vygeneroval, PARTITION BY by zmizel, schéma
    // by prošlo a projevilo by se to až u zákazníka na objemu dat.
    const sql = readFileSync(
      new URL('../migrations/0001_core_tables.sql', import.meta.url),
      'utf8',
    );
    for (const table of [
      'messages',
      'message_events',
      'provider_event_receipts',
      'web_events',
      'webhook_events',
      'webhook_deliveries',
      'audit_log',
      'inbound_deliveries',
      'message_engagement',
    ]) {
      // Vzor je týž jako grep ve Step 4 plánu. Původní `CREATE TABLE[^;]*"?…`
      // je slepý vůči vlastnímu názvu: `[^;]*` přeskočí přes celou hlavičku,
      // takže `CREATE TABLE "ai_messages" (` se tváří jako založení `messages`
      // a test by hlásil chybu, která tam není.
      expect(sql, `migrace 0001 zakládá partitionovanou tabulku ${table}`).not.toMatch(
        new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?\\s*\\(`),
      );
    }
  });

  it('templates.current_version_id má pojmenovaný cizí klíč na template_versions', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'templates'::regclass AND contype = 'f'
          AND conname = 'fk_templates__current_version'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('REFERENCES template_versions(id)');
    expect(rows[0].def).toContain('ON DELETE SET NULL');
  });
});

describe('doplňky schématu z doplňkového průchodu', () => {
  const sloupec = async (table: string, column: string) => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );
    return rows[0];
  };

  it('api_keys nese oba sloupce pro odklad při rotaci klíče', async () => {
    // Bez nich je rotace nutně okamžitá a integrace zákazníka přestane
    // fungovat ve chvíli, kdy si v UI vygeneruje nový klíč.
    expect((await sloupec('api_keys', 'previous_secret_hash'))?.data_type).toBe('bytea');
    expect((await sloupec('api_keys', 'previous_expires_at'))?.data_type).toBe(
      'timestamp with time zone',
    );
  });

  it('hash předchozího klíče bez konce odkladu neprojde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO api_keys (workspace_id, name, kind, prefix, secret_hash,
                             previous_secret_hash)
       VALUES ($1, 'k', 'secret', 'abcdefgh', '\\x00'::bytea, '\\x01'::bytea)`,
        [ws.workspaceA],
      ),
    ).rejects.toThrow(/ck_api_keys__previous_secret/);
  });

  it('rate_limits existuje, nemá workspace_id a RLS na ní neběží', async () => {
    expect(await sloupec('rate_limits', 'bucket')).toBeDefined();
    expect(
      await sloupec('rate_limits', 'workspace_id'),
      'rozsah nese textový klíč, ne sloupec (R36)',
    ).toBeUndefined();
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'rate_limits'`,
      );
    expect(rows[0].relrowsecurity).toBe(false);
  });

  it('rate_limits počítá atomicky a odmítne kbelík ve špatném tvaru', async () => {
    const zapis = () =>
      h.as('mlain_migrator').query<{ hits: number }>(
        `INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
       VALUES ('user:u1:login', date_trunc('minute', now()), 1, now() + interval '1 min')
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      );
    expect((await zapis()).rows[0].hits).toBe(1);
    expect((await zapis()).rows[0].hits, 'druhý zápis musí kolidovat, ne založit řádek').toBe(2);
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
       VALUES ('spatny_tvar', now(), 1, now())`,
      ),
    ).rejects.toThrow(/ck_rate_limits__bucket/);
  });

  it('contacts.search_key existuje a má vlastní trigramový index', async () => {
    expect((await sloupec('contacts', 'search_key'))?.data_type).toBe('text');
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'contacts' AND indexname = 'idx_contacts__search_key_trgm'`,
    );
    expect(rows[0].indexdef).toContain('gin_trgm_ops');
  });

  it('hledání bez diakritiky najde kontakt s diakritikou', async () => {
    // Ověřeno spuštěním, že to jinak nejde: unaccent() je STABLE, ne IMMUTABLE,
    // takže generovaný sloupec ani indexový výraz ho použít nemůže.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO contacts (workspace_id, email, first_name, last_name, search_key)
       VALUES ($1, 'novacek@example.test', 'Petr', 'Nováček',
               'petr novacek novacek@example.test')`,
      [ws.workspaceA],
    );
    const { rows } = await h.as('mlain_migrator').query<{ last_name: string }>(
      `SELECT last_name FROM contacts
        WHERE workspace_id = $1 AND search_key LIKE '%novacek%'`,
      [ws.workspaceA],
    );
    expect(rows.map((r) => r.last_name)).toContain('Nováček');
  });

  it('imports nese oba sloupce a nesmí navazovat sám na sebe', async () => {
    expect((await sloupec('imports', 'stored_error_count'))?.is_nullable).toBe('NO');
    expect((await sloupec('imports', 'resume_from_import_id'))?.data_type).toBe('uuid');
    const { rows } = await h.as('mlain_migrator').query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'ck_imports__resume_not_self'`,
    );
    expect(rows[0].def).toContain('DISTINCT FROM');
  });

  it('campaigns.audience_breakdown je jsonb a smí být prázdné', async () => {
    const col = await sloupec('campaigns', 'audience_breakdown');
    expect(col?.data_type).toBe('jsonb');
    expect(col?.is_nullable, 'kampaň bez zmrazeného publika rozpad nemá').toBe('YES');
  });

  it('sender_domains nese delegaci a token je unikátní jen když existuje', async () => {
    for (const c of ['delegation_token_hash', 'delegation_expires_at', 'delegation_created_by']) {
      expect(await sloupec('sender_domains', c), `chybí ${c}`).toBeDefined();
    }
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'sender_domains'
          AND indexname = 'uq_sender_domains__delegation_token'`,
    );
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef, 'bez částečnosti by druhá doména bez delegace neprošla').toContain(
      'WHERE',
    );
  });

  it('campaign_links.id nemá DEFAULT, takže zápis bez id spadne hlasitě', async () => {
    // S DEFAULT by odkaz v už odeslaném e-mailu na řádek nenavázal
    // a report odkazů by zůstal prázdný, aniž by cokoli spadlo (R40).
    expect((await sloupec('campaign_links', 'id'))?.column_default).toBeNull();
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO campaign_links (workspace_id, campaign_id, url, position)
       VALUES ($1, gen_random_uuid(), 'https://example.test', 0)`,
        [ws.workspaceA],
      ),
    ).rejects.toThrow(/null value in column "id"/);
  });

  it('všechny čtyři šifrované obálky mají týž typ text', async () => {
    // Kontrakt 4.10.4 je textový. Dva sloupce v bytea by rotaci klíče nutily
    // pracovat na každém jinak.
    for (const [table, column] of [
      ['sending_providers', 'config_encrypted'],
      ['webhook_endpoints', 'secret_encrypted'],
      ['inbound_endpoints', 'secret_encrypted'],
      ['ai_provider_credentials', 'api_key_encrypted'],
    ] as const) {
      expect((await sloupec(table, column))?.data_type, `${table}.${column}`).toBe('text');
    }
  });
});
