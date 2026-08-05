// Chování politik z migrace 0004 pod SKUTEČNÝMI rolemi.
//
// rls-registry.test.ts se ptá katalogu, jestli politika existuje. To je málo:
// politika, která existuje a nechrání, vypadá v pg_policies stejně jako ta,
// která chrání. Tenhle soubor proto ke KAŽDÉ ze třinácti politik zkouší její
// PORUŠENÍ pod rolí, na kterou RLS skutečně dopadá (mlain_app, mlain_sender,
// mlain_maintenance), nikdy pod migrátorem: migrátor vlastní schéma a RLS
// obchází, takže test pod ním by byl zelený i s vypnutými politikami.
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { type Harness, type RoleName, startHarness } from './helpers/container';
import { expectRlsViolation } from './helpers/errors';
import { seedTwoWorkspaces, type TwoWorkspaces } from './helpers/fixtures';
import { ensureUpcomingPartitions } from '../src/partitions';

let h: Harness;
let ws: TwoWorkspaces;

beforeAll(async () => {
  h = await startHarness();
  // Šablona se migruje s ensurePartitions: false, aby zůstala malá. Zápis
  // do partitionované tabulky bez oddílu skončí chybou "no partition found",
  // což je záměr (výchozí oddíl se nezakládá), ne selhání politiky.
  await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
  ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
}, 180_000);
afterAll(async () => {
  await h.stop();
});

/**
 * Spustí callback v transakci pod danou rolí s kontextem nastaveným přes
 * SET LOCAL, tedy tak, jak to bude dělat repository vrstva. Kontext se
 * nastavuje POUZE tady, aby test nemohl omylem běžet pod migrátorem.
 */
async function withContext<T>(
  role: RoleName,
  context: { workspaceId?: string; userId?: string },
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await h.as(role).connect();
  try {
    await client.query('BEGIN');
    if (context.workspaceId !== undefined) {
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [
        context.workspaceId,
      ]);
    }
    if (context.userId !== undefined) {
      await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [context.userId]);
    }
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe('ws_isolation pod mlain_app', () => {
  it('kontakt cizího projektu není vidět ani přes explicitní id', async () => {
    const cizi = uuidv7();
    await h
      .as('mlain_migrator')
      .query(`INSERT INTO contacts (id, workspace_id, email) VALUES ($1, $2, $3)`, [
        cizi,
        ws.workspaceB,
        `b-${cizi}@example.test`,
      ]);

    const rows = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const { rows } = await c.query('SELECT id FROM contacts WHERE id = $1', [cizi]);
      return rows;
    });
    expect(rows, 'ws_isolation pustila řádek cizího projektu').toHaveLength(0);
  });

  it('zápis pod cizím workspace_id skončí chybou politiky, ne tichým uložením', async () => {
    await expect(
      withContext('mlain_app', { workspaceId: ws.workspaceA }, (c) =>
        c.query(`INSERT INTO contacts (workspace_id, email) VALUES ($1, 'x@example.test')`, [
          ws.workspaceB,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('UPDATE cizího řádku neovlivní nic, protože ho USING nepustí', async () => {
    const cizi = uuidv7();
    await h
      .as('mlain_migrator')
      .query(`INSERT INTO contacts (id, workspace_id, email) VALUES ($1, $2, $3)`, [
        cizi,
        ws.workspaceB,
        `b2-${cizi}@example.test`,
      ]);
    const affected = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const result = await c.query(`UPDATE contacts SET first_name = 'hacked' WHERE id = $1`, [
        cizi,
      ]);
      return result.rowCount;
    });
    expect(affected).toBe(0);
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ first_name: string | null }>('SELECT first_name FROM contacts WHERE id = $1', [
        cizi,
      ]);
    expect(rows[0].first_name).toBeNull();
  });

  it('bez kontextu nevrátí ws_isolation nic', async () => {
    const { rows } = await h.as('mlain_app').query('SELECT id FROM contacts');
    expect(rows).toHaveLength(0);
  });

  /**
   * Rozhodnutí R21 v běhu. Na spojení, které kontext KDYSI mělo, vrací
   * current_setting(..., true) po commitu PRÁZDNÝ ŘETĚZEC, ne NULL.
   * S holým current_setting by ''::uuid skončilo chybou 22P02 a druhý dotaz
   * ze stejného poolového spojení by SPADL. Tenhle test drží NULLIF na místě.
   */
  it('recyklované spojení po commitu vrátí prázdno, ne chybu 22P02', async () => {
    const client = await h.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ws.workspaceA]);
      await client.query('COMMIT');

      // Premisa: hodnota je prázdný řetězec, ne NULL. Kdyby byla NULL,
      // netestoval by tenhle případ nic.
      const { rows: ctx } = await client.query<{ v: string | null }>(
        `SELECT current_setting('mlain.workspace_id', true) AS v`,
      );
      expect(ctx[0].v, 'premisa R21 neplatí, test by byl slepý').toBe('');

      const { rows } = await client.query('SELECT id FROM contacts');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('všech 90 politik čte kontext přes NULLIF, žádná holým current_setting', async () => {
    // Katalogová pojistka nad VŠEMI politikami naráz. Behaviorální testy výš
    // pokrývají jednotlivé cesty, tahle kontrola pokrývá i ty, které dnes
    // vlastní test nemají, a novou politiku bez NULLIF zachytí hned.
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ tablename: string; policyname: string; expr: string }>(
        `SELECT tablename, policyname,
                coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
           FROM pg_policies WHERE schemaname = 'public'`,
      );
    // 88 platilo do migrace 0010. 0011 přidala `asset_public_lookup`
    // a 0013 `ws_isolation` na `sender_identities`, tedy 90.
    expect(rows).toHaveLength(90);
    const spatne: string[] = [];
    for (const row of rows) {
      // Každý výskyt current_setting musí být obalený NULLIF(...). Počty se
      // musí rovnat, jinak je aspoň jeden holý.
      const setting = row.expr.match(/current_setting\(/g)?.length ?? 0;
      const nullif = row.expr.match(/NULLIF\(current_setting\(/gi)?.length ?? 0;
      if (setting !== nullif) spatne.push(`${row.tablename}.${row.policyname}`);
    }
    expect(
      spatne,
      'politika s holým current_setting spadne na 22P02 nebo pustí cizí zápis',
    ).toEqual([]);
  });
});

describe('audit_log: ws_isolation_audit a user_own_global_audit', () => {
  it('globální záznam bez workspace projde, cizí workspace neprojde', async () => {
    await withContext('mlain_app', { workspaceId: ws.workspaceA, userId: ws.userId }, (c) =>
      c.query(
        `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
         VALUES (NULL, 'user', $1, 'user.password_changed')`,
        [ws.userId],
      ),
    );

    await expect(
      withContext('mlain_app', { workspaceId: ws.workspaceA }, (c) =>
        c.query(
          `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
           VALUES ($1, 'user', $2, 'contact.created')`,
          [ws.workspaceB, ws.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('pod kontextem projektu se nevrátí ani jeden globální řádek (kritérium 21c)', async () => {
    await withContext('mlain_app', { workspaceId: ws.workspaceA, userId: ws.userId }, (c) =>
      c.query(
        `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
         VALUES ($1, 'user', $2, 'contact.created')`,
        [ws.workspaceA, ws.userId],
      ),
    );

    const rows = await withContext(
      'mlain_app',
      { workspaceId: ws.workspaceA, userId: ws.userId },
      async (c) => {
        const { rows } = await c.query<{ workspace_id: string | null }>(
          'SELECT workspace_id FROM audit_log',
        );
        return rows;
      },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.filter((r) => r.workspace_id === null),
      'user_own_global_audit pustila globální řádek pod workspace kontextem',
    ).toHaveLength(0);
  });

  it('bez workspace kontextu vidí uživatel jen SVOJE globální záznamy', async () => {
    const cizi = uuidv7();
    await h.as('mlain_migrator').query(
      `INSERT INTO users (id, email, password_hash, locale, timezone)
         VALUES ($1, $2, 'argon2id$dummy', 'cs', 'Europe/Prague')`,
      [cizi, `other-${cizi}@example.test`],
    );
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
         VALUES (NULL, 'user', $1, 'user.login')`,
      [cizi],
    );

    const rows = await withContext('mlain_app', { userId: ws.userId }, async (c) => {
      const { rows } = await c.query<{ actor_id: string; workspace_id: string | null }>(
        'SELECT actor_id, workspace_id FROM audit_log',
      );
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.workspace_id).toBeNull();
      expect(row.actor_id, 'vidím globální záznam cizího uživatele').toBe(ws.userId);
    }
  });

  it('audit_log je pro aplikaci append only: UPDATE i DELETE končí na oprávnění', async () => {
    await expect(h.as('mlain_app').query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(h.as('mlain_app').query('DELETE FROM audit_log')).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('workspaces: ws_isolation_self, ws_member_visibility, ws_insert_bootstrap', () => {
  it('pod kontextem projektu A je vidět jen projekt A', async () => {
    const rows = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces');
      return rows;
    });
    expect(rows.map((r) => r.id)).toEqual([ws.workspaceA]);
  });

  it('výpis projektů aktéra vidí obojí, protože je členem obou', async () => {
    const rows = await withContext('mlain_app', { userId: ws.userId }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces ORDER BY id');
      return rows;
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ws.workspaceA, ws.workspaceB].sort());
  });

  /**
   * Kritérium 21d. Nález P04-B, naměřený běhovým důkazem pod mlain_app:
   * withWorkspace u aktéra typu user nastavuje OBA GUC naráz a politiky se
   * v PostgreSQL OR-ují, takže ws_member_visibility bez podmínky na chybějící
   * workspace kontext propouštěla i ostatní projekty téhož uživatele. Dva
   * řádky místo jednoho. Únik mezi zákazníky to nebyl, rozpor mezi chováním
   * a kritériem ano.
   *
   * Tenhle test drží podmínku na místě. Kdyby z ws_member_visibility zmizela,
   * vrátí dotaz zase dva řádky a test spadne. Ověřeno spuštěním: před opravou
   * migrace 0004 vracel dva, po ní jeden.
   */
  it('uvnitř projektu B nevidí aktér ostatní SVOJE projekty (kritérium 21d)', async () => {
    const rows = await withContext(
      'mlain_app',
      { workspaceId: ws.workspaceB, userId: ws.userId },
      async (c) => {
        const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces ORDER BY id');
        return rows;
      },
    );
    expect(
      rows.map((r) => r.id),
      'ws_member_visibility se uplatnila i pod workspace kontextem',
    ).toEqual([ws.workspaceB]);
  });

  it('cizí uživatel přes ws_member_visibility nevidí nic', async () => {
    const cizi = uuidv7();
    await h.as('mlain_migrator').query(
      `INSERT INTO users (id, email, password_hash, locale, timezone)
         VALUES ($1, $2, 'argon2id$dummy', 'cs', 'Europe/Prague')`,
      [cizi, `nomember-${cizi}@example.test`],
    );
    const rows = await withContext('mlain_app', { userId: cizi }, async (c) => {
      const { rows } = await c.query('SELECT id FROM workspaces');
      return rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('založení projektu bez aktéra neprojde, s aktérem ano', async () => {
    await expect(
      withContext('mlain_app', {}, (c) =>
        c.query(
          `INSERT INTO workspaces (name, slug, locale, timezone, created_by)
           VALUES ('bez aktéra', $1, 'cs', 'Europe/Prague', NULL)`,
          [`no-actor-${uuidv7()}`],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    const novy = uuidv7();
    await withContext('mlain_app', { userId: ws.userId }, (c) =>
      c.query(
        `INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
         VALUES ($1, 'nový', $2, 'cs', 'Europe/Prague', $3)`,
        [novy, `new-${novy}`, ws.userId],
      ),
    );
    const { rows } = await h
      .as('mlain_migrator')
      .query('SELECT id FROM workspaces WHERE id = $1', [novy]);
    expect(rows).toHaveLength(1);
  });

  /**
   * Druhá polovina rozhodnutí R21, ta bezpečnostní. Holé
   * `current_setting('mlain.user_id', true) IS NOT NULL` je na prázdném
   * řetězci PRAVDA, takže na recyklovaném spojení by ws_insert_bootstrap
   * pustila založení projektu BEZ přihlášeného uživatele.
   */
  it('recyklované spojení bez aktéra projekt nezaloží', async () => {
    const client = await h.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [ws.userId]);
      await client.query('COMMIT');

      const { rows: ctx } = await client.query<{ v: string | null }>(
        `SELECT current_setting('mlain.user_id', true) AS v`,
      );
      expect(ctx[0].v, 'premisa R21 neplatí, test by byl slepý').toBe('');

      const slug = `recycled-${uuidv7()}`;
      await expect(
        client.query(
          `INSERT INTO workspaces (name, slug, locale, timezone, created_by)
           VALUES ('recyklované', $1, 'cs', 'Europe/Prague', NULL)`,
          [slug],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      client.release();
    }
  });

  it('user_own_memberships ukáže vlastní členství i bez workspace kontextu', async () => {
    const rows = await withContext('mlain_app', { userId: ws.userId }, async (c) => {
      const { rows } = await c.query<{ workspace_id: string }>(
        'SELECT workspace_id FROM memberships',
      );
      return rows;
    });
    expect(rows.map((r) => r.workspace_id).sort()).toEqual([ws.workspaceA, ws.workspaceB].sort());
  });
});

describe('sender_bypass pod rolí mlain_sender', () => {
  const campaignId = uuidv7();
  const builtAt = '2026-08-10T00:00:00Z';

  beforeAll(async () => {
    await h.as('mlain_migrator').query(
      `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
       VALUES ($1, $2, 'kampaň', 'sending', $3)`,
      [campaignId, ws.workspaceA, builtAt],
    );
    await h.as('mlain_migrator').query(
      `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position)
         VALUES ($1, $2, $3, 'https://example.test', 0)`,
      [uuidv7(), ws.workspaceA, campaignId],
    );
    await h.as('mlain_migrator').query(
      `INSERT INTO suppressions (workspace_id, email, fingerprint, fingerprint_key_id,
                                 reason, source)
       VALUES ($1, 'stop@example.test', '\\x00'::bytea, 1, 'manual', 'admin')`,
      [ws.workspaceA],
    );
  });

  it('sender čte outbox a metadata bez jakéhokoli workspace kontextu', async () => {
    // Bez sender_bypass by každý z těch dotazů vrátil NULA ŘÁDKŮ, a to
    // BEZ CHYBY. Prázdná dávka je legitimní stav, takže by se to nikdy
    // neprojevilo jinak než tím, že se nic neodešle.
    for (const [table, minimum] of [
      ['campaigns', 1],
      ['campaign_links', 1],
      ['workspaces', 2],
      ['suppressions', 1],
    ] as const) {
      const { rows } = await h
        .as('mlain_sender')
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, `sender nevidí ${table}, claim by vracel prázdno`).toBeGreaterThanOrEqual(
        minimum,
      );
    }
    // sending_providers je prázdná tabulka, takže se ověřuje, že dotaz PROJDE
    // (grant i politika existují), ne kolik vrátí.
    await expect(
      h.as('mlain_sender').query('SELECT count(*) FROM sending_providers'),
    ).resolves.toBeDefined();
  });

  it('sender si claimne zprávu z cizího projektu a zapíše k ní událost', async () => {
    const messageId = uuidv7();
    await h.as('mlain_migrator').query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at)
       VALUES ($1, $2, $3, $4, 'a@example.test', 'pending', $5)`,
      [messageId, ws.workspaceA, campaignId, ws.contactInA, builtAt],
    );

    const claim = await h.as('mlain_sender').query(
      `UPDATE messages SET status = 'claimed', claimed_by = 'sender-1',
              claimed_at = now(), updated_at = now()
        WHERE id = $1 AND created_at = $2`,
      [messageId, builtAt],
    );
    expect(claim.rowCount, 'sender_bypass na messages nefunguje, claim je prázdný').toBe(1);

    await h.as('mlain_sender').query(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, recipient, type, ts, source)
       VALUES ($1, $2, $3, $4, $5, 'a@example.test', 'delivered', now(), 'ses_sns')`,
      [ws.workspaceA, messageId, builtAt, campaignId, ws.contactInA],
    );
  });

  it('sender smí kampaň jen pozastavit, přechod na sent i cancelled RLS zastaví', async () => {
    // Sloupcový grant povoluje zápis do status, ale neříká nic o HODNOTĚ.
    // Kdyby politika WITH CHECK neměla, použil by PostgreSQL u UPDATE
    // klauzuli USING, a ta je true, takže by sender kampaň mohl "dokončit".
    const pause = await h
      .as('mlain_sender')
      .query(`UPDATE campaigns SET status = 'paused' WHERE id = $1`, [campaignId]);
    expect(pause.rowCount).toBe(1);

    for (const status of ['sent', 'cancelled'] as const) {
      await expect(
        h
          .as('mlain_sender')
          .query(`UPDATE campaigns SET status = $2 WHERE id = $1`, [campaignId, status]),
      ).rejects.toThrow(/row-level security/i);
    }
    await h
      .as('mlain_migrator')
      .query(`UPDATE campaigns SET status = 'sending' WHERE id = $1`, [campaignId]);
  });

  it('sender zapíše agregované varování renderu přes ON CONFLICT DO UPDATE', async () => {
    const zapis = () =>
      h.as('mlain_sender').query(
        `INSERT INTO campaign_render_warnings (workspace_id, campaign_id, code, path, count)
         VALUES ($1, $2, 'missing_value', 'contact.attributes.city', 1)
         ON CONFLICT (workspace_id, campaign_id, code, path)
         DO UPDATE SET count = campaign_render_warnings.count + 1,
                       last_seen_at = now()`,
        [ws.workspaceA, campaignId],
      );
    await zapis();
    await zapis();
    const { rows } = await h.as('mlain_migrator').query<{ count: number }>(
      // count je bigint, ovladač ho vrací jako řetězec; přetypování je tady,
      // ať se test ptá na číslo, ne na jeho zápis.
      `SELECT count::int AS count FROM campaign_render_warnings WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(rows[0].count, 'druhý zápis nesepnul na ON CONFLICT').toBe(2);
  });

  it('sender nemá přístup ke kontaktům ani k auditu, ani přes rodičovskou tabulku', async () => {
    for (const table of ['contacts', 'users', 'audit_log', 'web_events'] as const) {
      await expect(
        h.as('mlain_sender').query(`SELECT count(*) FROM ${table}`),
        `sender se dostal na ${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Bezkontextové dohledávací politiky (požadavky P04→P03.5 a P04→P03.6).
//
// Obě cesty mají tutéž vlastnost: kontext projektu se z principu ještě NEZNÁ,
// protože se teprve zjišťuje z tajemství, které volající poslal. Bez politiky
// nevrátí dotaz nic a chová se to jako správné odmítnutí: „klíč neexistuje",
// „pozvánka neexistuje". Testy níž proto vždycky ověřují OBĚ strany, tedy že
// dohledání projde a že se tím zároveň nerozšířilo, co je vidět jinudy.
// ---------------------------------------------------------------------------

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Prefix sekretního klíče podle ck_api_keys__prefix: osm znaků [a-z2-7]. */
function randomPrefix(): string {
  return Array.from(randomBytes(8), (b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join('');
}

async function seedWorkspace(name: string): Promise<string> {
  const id = uuidv7();
  await h.as('mlain_migrator').query(
    `INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
     VALUES ($1, $2, $3, 'cs', 'Europe/Prague', NULL)`,
    [id, name, `${name}-${id}`],
  );
  return id;
}

async function seedUser(): Promise<string> {
  const id = uuidv7();
  await h.as('mlain_migrator').query(
    `INSERT INTO users (id, email, password_hash, locale, timezone)
     VALUES ($1, $2, 'argon2id$dummy', 'cs', 'Europe/Prague')`,
    [id, `u-${id}@example.test`],
  );
  return id;
}

async function seedApiKey(
  workspaceId: string,
  options: { revoked?: boolean; lastUsedAt?: string | null } = {},
): Promise<{ id: string; prefix: string }> {
  const id = uuidv7();
  const prefix = randomPrefix();
  await h.as('mlain_migrator').query(
    `INSERT INTO api_keys (id, workspace_id, name, kind, prefix, secret_hash, scopes,
                           revoked_at, last_used_at)
     VALUES ($1, $2, 'klíč', 'secret', $3, '\\x00'::bytea, ARRAY['contacts:read'], $4, $5)`,
    [
      id,
      workspaceId,
      prefix,
      options.revoked === true ? new Date().toISOString() : null,
      options.lastUsedAt ?? null,
    ],
  );
  return { id, prefix };
}

async function seedInvitation(
  workspaceId: string,
  options: { expired?: boolean; accepted?: boolean; revoked?: boolean } = {},
): Promise<{ id: string; token: Buffer }> {
  const id = uuidv7();
  const token = randomBytes(32);
  const now = new Date();
  await h.as('mlain_migrator').query(
    `INSERT INTO invitations (id, workspace_id, email, role, token_hash, expires_at,
                              accepted_at, accepted_by, revoked_at)
     VALUES ($1, $2, $3, 'editor', $4, $5, $6, NULL, $7)`,
    [
      id,
      workspaceId,
      `invitee-${id}@example.test`,
      token,
      new Date(now.getTime() + (options.expired === true ? -3_600_000 : 3_600_000)).toISOString(),
      options.accepted === true ? now.toISOString() : null,
      options.revoked === true ? now.toISOString() : null,
    ],
  );
  return { id, token };
}

/** Přesně ten dotaz, kterým P04 ověřuje klíč (loadApiKeyRow), i s JOINem. */
const LOOKUP_API_KEY = `
  SELECT k.id::text AS id, k.workspace_id::text AS workspace_id, k.scopes AS scopes,
         w.deleted_at AS workspace_deleted_at
    FROM api_keys k
    JOIN workspaces w ON w.id = k.workspace_id
   WHERE k.prefix = $1 AND k.kind = 'secret'
   LIMIT 1`;

describe('api_key_lookup a ws_api_key_lookup: ověření klíče bez kontextu (P04→P03.5)', () => {
  it('ověřovací dotaz najde klíč i s JOINem na workspaces, bez jakéhokoli kontextu', async () => {
    const key = await seedApiKey(ws.workspaceA);
    const rows = await withContext('mlain_app', {}, async (c) => {
      const { rows } = await c.query<{ workspace_id: string; workspace_deleted_at: Date | null }>(
        LOOKUP_API_KEY,
        [key.prefix],
      );
      return rows;
    });
    // Bez api_key_lookup vrátí dotaz nula řádků a KAŽDÝ požadavek s hlavičkou
    // Authorization: Bearer skončí na `unauthenticated`. Bez ws_api_key_lookup
    // vrátí nula řádků taky, jen o krok dál: klíč se najde a JOIN ho zahodí.
    expect(
      rows,
      'ověření klíče nevrátilo řádek, každý Bearer požadavek by byl unauthenticated',
    ).toHaveLength(1);
    expect(rows[0].workspace_id).toBe(ws.workspaceA);
    expect(rows[0].workspace_deleted_at).toBeNull();
  });

  it('revokovaný klíč se bez kontextu nenajde', async () => {
    const key = await seedApiKey(ws.workspaceA, { revoked: true });
    const rows = await withContext('mlain_app', {}, async (c) => {
      const { rows } = await c.query(LOOKUP_API_KEY, [key.prefix]);
      return rows;
    });
    expect(rows, 'revokovaný klíč prošel politikou api_key_lookup').toHaveLength(0);
  });

  it('pod kontextem projektu A není klíč projektu B vidět ani přes prefix', async () => {
    const key = await seedApiKey(ws.workspaceB);
    const rows = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const { rows } = await c.query('SELECT id FROM api_keys WHERE prefix = $1', [key.prefix]);
      return rows;
    });
    expect(rows, 'api_key_lookup se uplatnila i pod workspace kontextem').toHaveLength(0);
  });

  it('bez kontextu je vidět jen projekt, který má živý klíč', async () => {
    const sKlicem = await seedWorkspace('ws-s-klicem');
    const bezKlice = await seedWorkspace('ws-bez-klice');
    await seedApiKey(sKlicem);

    const videne = await withContext('mlain_app', {}, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces');
      return rows.map((r) => r.id);
    });
    expect(videne).toContain(sKlicem);
    expect(videne, 'ws_api_key_lookup pustila projekt bez jediného klíče').not.toContain(bezKlice);
  });

  /**
   * Podmínka „mlain.user_id NENÍ nastavený" v ws_api_key_lookup drží tenhle
   * test. Bez ní by se politika uplatnila na výpisu projektů, který jede přes
   * withUser a čte holé SELECT FROM workspaces, a uživatel by ve svém seznamu
   * uviděl cizí projekt jen proto, že má API klíč.
   */
  it('výpis projektů pod mlain.user_id se cizím projektem s klíčem nerozšíří', async () => {
    const cizi = await seedWorkspace('ws-cizi-s-klicem');
    await seedApiKey(cizi);

    const videne = await withContext('mlain_app', { userId: ws.userId }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces');
      return rows.map((r) => r.id);
    });
    expect(videne.sort()).toEqual([ws.workspaceA, ws.workspaceB].sort());
    expect(videne, 'ws_api_key_lookup prosákla do výpisu projektů uživatele').not.toContain(cizi);
  });
});

describe('api_key_touch: zápis last_used_at bez kontextu', () => {
  it('bezkontextový UPDATE last_used_at zapíše právě jeden řádek', async () => {
    const key = await seedApiKey(ws.workspaceA);
    const affected = await withContext('mlain_app', {}, async (c) => {
      const result = await c.query(
        `UPDATE api_keys SET last_used_at = now()
          WHERE id = $1::uuid
            AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`,
        [key.id],
      );
      return result.rowCount;
    });
    // Bez api_key_touch je to nula řádků BEZ CHYBY: zápis je fire and forget,
    // takže by se last_used_at nezapsal nikdy a nikdo by se to nedozvěděl.
    expect(affected, 'bez api_key_touch se last_used_at nezapíše nikdy').toBe(1);

    const { rows } = await h
      .as('mlain_migrator')
      .query<{ last_used_at: Date | null }>('SELECT last_used_at FROM api_keys WHERE id = $1', [
        key.id,
      ]);
    expect(rows[0].last_used_at).not.toBeNull();
  });

  it('bezkontextový zápis do scopes skončí chybou RLS, ne tichým rozšířením práv', async () => {
    // Klíč se naposledy použil před hodinou, takže WITH CHECK na čerstvý
    // last_used_at neprojde. Bez téhle podmínky by šlo klíči bez jakéhokoli
    // kontextu dopsat oprávnění.
    const key = await seedApiKey(ws.workspaceA, {
      lastUsedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    await expectRlsViolation(
      () =>
        withContext('mlain_app', {}, (c) =>
          c.query(`UPDATE api_keys SET scopes = ARRAY['contacts:write'] WHERE id = $1::uuid`, [
            key.id,
          ]),
        ),
      'bezkontextový UPDATE scopes prošel',
    );

    const { rows } = await h
      .as('mlain_migrator')
      .query<{ scopes: string[] }>('SELECT scopes FROM api_keys WHERE id = $1', [key.id]);
    expect(rows[0].scopes).toEqual(['contacts:read']);
  });

  it('revokovaného klíče se bezkontextový UPDATE nedotkne', async () => {
    const key = await seedApiKey(ws.workspaceA, { revoked: true });
    const affected = await withContext('mlain_app', {}, async (c) => {
      const result = await c.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1::uuid`, [
        key.id,
      ]);
      return result.rowCount;
    });
    expect(affected, 'api_key_touch pustila revokovaný klíč').toBe(0);
  });

  /**
   * Přísný WITH CHECK u api_key_touch nesmí zablokovat správu klíčů pod
   * workspace kontextem. Permisivní politiky se OR-ují a u UPDATE stačí, když
   * projde USING i WITH CHECK jedné z nich, tady ws_isolation. Ověřuje se
   * spuštěním, protože právě tenhle druh součinu dvou politik se dá snadno
   * odhadnout špatně: rotace i revokace by jinak přestaly fungovat.
   */
  it('rotace i revokace klíče pod workspace kontextem prochází dál', async () => {
    const key = await seedApiKey(ws.workspaceA, {
      lastUsedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const zmeny = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const rotace = await c.query(
        `UPDATE api_keys SET scopes = ARRAY['contacts:write'], updated_at = now()
          WHERE id = $1::uuid`,
        [key.id],
      );
      const revokace = await c.query(
        `UPDATE api_keys SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL`,
        [key.id],
      );
      return { rotace: rotace.rowCount, revokace: revokace.rowCount };
    });
    expect(zmeny.rotace, 'api_key_touch zablokovala rotaci pod workspace kontextem').toBe(1);
    expect(zmeny.revokace, 'api_key_touch zablokovala revokaci pod workspace kontextem').toBe(1);
  });
});

describe('invitation_token_lookup: přijetí pozvánky bez členství (P04→P03.6)', () => {
  const LOOKUP_INVITATION = `
    SELECT id::text AS id, workspace_id::text AS workspace_id, role
      FROM invitations
     WHERE token_hash = $1
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     LIMIT 1`;

  it('pozvánku podle token_hash najde i uživatel, který v projektu není', async () => {
    const pozvanka = await seedInvitation(ws.workspaceA);
    const pozvany = await seedUser();

    const rows = await withContext('mlain_app', { userId: pozvany }, async (c) => {
      const { rows } = await c.query<{ workspace_id: string; role: string }>(LOOKUP_INVITATION, [
        pozvanka.token,
      ]);
      return rows;
    });
    // Bez invitation_token_lookup je to nula řádků a acceptInvitation vrací
    // 404 vždycky. Plán vrací 404 i u neplatného tokenu schválně, takže by
    // z chybové hlášky na příčinu nikdo nepřišel.
    expect(rows, 'pozvánka se nenašla, acceptInvitation by vracelo 404 vždy').toHaveLength(1);
    expect(rows[0].workspace_id).toBe(ws.workspaceA);
  });

  it('prošlá, odvolaná ani přijatá pozvánka se nenajde', async () => {
    const pozvany = await seedUser();
    for (const stav of [{ expired: true }, { revoked: true }, { accepted: true }] as const) {
      const pozvanka = await seedInvitation(ws.workspaceB, stav);
      const rows = await withContext('mlain_app', { userId: pozvany }, async (c) => {
        const { rows } = await c.query(LOOKUP_INVITATION, [pozvanka.token]);
        return rows;
      });
      expect(rows, `politika pustila pozvánku ve stavu ${JSON.stringify(stav)}`).toHaveLength(0);
    }
  });

  it('pod kontextem projektu A není pozvánka projektu B vidět', async () => {
    const pozvanka = await seedInvitation(ws.workspaceB);
    const rows = await withContext('mlain_app', { workspaceId: ws.workspaceA }, async (c) => {
      const { rows } = await c.query('SELECT id FROM invitations WHERE token_hash = $1', [
        pozvanka.token,
      ]);
      return rows;
    });
    expect(rows, 'invitation_token_lookup se uplatnila i pod workspace kontextem').toHaveLength(0);
  });

  /**
   * Celý průchod přijetí pod skutečnou rolí, tak jak ho popisuje P04: první
   * transakce dohledá pozvánku podle tokenu bez workspace kontextu, druhá už
   * kontext SESTAVENÝ Z POZVÁNKY má, takže jméno a slug projektu přečte přes
   * ws_isolation_self a členství založí přes ws_isolation.
   *
   * Jméno projektu se čte AŽ TADY. V první transakci by ho nešlo přečíst
   * a nepomohla by ani politika: viz test níž.
   */
  it('celý průchod přijetí projde: dohledání, přečtení projektu, členství', async () => {
    const pozvanka = await seedInvitation(ws.workspaceA);
    const pozvany = await seedUser();

    const found = await withContext('mlain_app', { userId: pozvany }, async (c) => {
      const { rows } = await c.query<{ id: string; workspace_id: string; role: string }>(
        LOOKUP_INVITATION,
        [pozvanka.token],
      );
      return rows[0];
    });
    expect(found).toBeDefined();

    const projekt = await withContext(
      'mlain_app',
      { workspaceId: found.workspace_id, userId: pozvany },
      async (c) => {
        const { rows: workspace } = await c.query<{ name: string; slug: string }>(
          'SELECT name, slug FROM workspaces WHERE deleted_at IS NULL',
        );
        const { rows: accepted } = await c.query<{ id: string }>(
          `UPDATE invitations SET accepted_at = now(), accepted_by = $2::uuid
            WHERE id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL
            RETURNING id`,
          [found.id, pozvany],
        );
        await c.query(
          `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [found.workspace_id, pozvany, found.role],
        );
        return { workspace, accepted };
      },
    );
    expect(
      projekt.workspace,
      'jméno projektu nešlo přečíst ani pod kontextem z pozvánky',
    ).toHaveLength(1);
    expect(projekt.accepted, 'UPDATE pozvánky neprošel politikou ws_isolation').toHaveLength(1);

    const { rows } = await h
      .as('mlain_migrator')
      .query<{ role: string }>(
        'SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2',
        [ws.workspaceA, pozvany],
      );
    expect(rows[0].role).toBe('editor');
  });

  /**
   * Proč na workspaces ŽÁDNÁ obdoba ws_api_key_lookup není. Přijetí běží pod
   * mlain.user_id, takže by taková politika platila i na výpisu projektů
   * (repo/workspaces-global.ts, holé SELECT FROM workspaces pod withUser)
   * a každý přihlášený uživatel by v seznamu viděl cizí projekt jen proto,
   * že v něm někdo má otevřenou pozvánku.
   *
   * Důsledek pro P04: dotaz, který v jedné transakci JOINuje invitations
   * s workspaces pod withUser, vrátí nula řádků. Jméno a slug se čtou až
   * v druhé transakci, viz test výš. Tenhle test drží tu hranici na místě.
   */
  it('projekt s otevřenou pozvánkou se pozvanému ve výpisu projektů neukáže', async () => {
    const cizi = await seedWorkspace('ws-s-pozvankou');
    await seedInvitation(cizi);
    const pozvany = await seedUser();

    const videne = await withContext('mlain_app', { userId: pozvany }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM workspaces');
      return rows.map((r) => r.id);
    });
    expect(videne, 'pozvaný uživatel vidí ve výpisu projekt, ve kterém není členem').toHaveLength(
      0,
    );
  });
});

describe('maintenance_bypass pod rolí mlain_maintenance', () => {
  it('retence smaže události napříč projekty, ne nula řádků bez chyby', async () => {
    for (const workspace of [ws.workspaceA, ws.workspaceB]) {
      await h.as('mlain_migrator').query(
        `INSERT INTO web_events (id, workspace_id, name, anonymous_id, occurred_at, received_at)
         VALUES ($1, $2, 'page_view', gen_random_uuid(), now(), now())`,
        [uuidv7(), workspace],
      );
    }

    const { rowCount } = await h
      .as('mlain_maintenance')
      .query(`DELETE FROM web_events WHERE received_at < now() + interval '1 minute'`);
    expect(rowCount, 'bez maintenance_bypass smaže DELETE nula řádků a NEVRÁTÍ CHYBU').toBe(2);
  });

  it('mimo web_events nemá údržba žádná práva', async () => {
    await expect(h.as('mlain_maintenance').query('SELECT count(*) FROM contacts')).rejects.toThrow(
      /permission denied/i,
    );
  });
});
