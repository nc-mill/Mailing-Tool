/**
 * Bootstrap a seedy databázových testů domény kampaní a providerů (plán P13, úkol 2).
 *
 * Harness je vědomě tenký: zakládá data přímo přes `rawSql`, ne přes doménové služby.
 * Kdyby seedoval přes ně, testoval by kód sám sebou a chyba ve službě by se schovala
 * do zeleného testu.
 *
 * ODCHYLKY OD PLÁNU, VYNUCENÉ REPOZITÁŘEM. Všechny jsou ověřené spuštěním.
 *
 * 1. **Kontejner si zakládá harness sám.** Plán počítal s tím, že `DATABASE_URL`
 *    a `DATABASE_URL_MIGRATOR` už v prostředí jsou a `packages/core` má skript
 *    `test:db` (požadavek R-P01.7). Ani jedno v repozitáři není a obojí leží
 *    v souborech, které vlastní P01. Používá se proto `startPgHarness()` z
 *    `../test-support/pg-harness`, tedy tentýž bootstrap, pod kterým dnes běží
 *    databázové testy identity, kontaktů, trackingu i platformy.
 * 2. **Projekt zakládá `createWorkspaceAsUser`, ne ruční trojice INSERTů.** Plán psal
 *    `INSERT INTO workspaces ... RETURNING`, jenže RLS politika `ws_insert_bootstrap`
 *    je `FOR INSERT` a na `RETURNING` nedosáhne, takže by ten zápis skončil na
 *    „new row violates row-level security policy". P03 pro ten případ vystavuje
 *    hotovou funkci a ta se tady používá.
 * 3. **`compile_meta` se do kampaně zapisuje, jen když sloupec existuje.** Požadavek
 *    R-P03.5 je otevřený: `campaigns.compile_meta` v migraci není (jediný `compile_meta`
 *    ve schématu má `template_versions`). Harness ten sloupec nedoplňuje, protože
 *    `packages/db` vlastní P03, ale zápis do něj je připravený, aby se po doplnění
 *    migrace nemusel měnit ani jeden test.
 * 4. **Otisk adresy v suppression je náhražka.** Skutečný recept je HMAC z části 1
 *    a klíčenka k němu v testu není. Dotazy P13 otisk jen porovnávají, takže je jim
 *    jedno, jak vznikl; podstatné je, že kontakt i suppression mají tytéž bajty.
 * 5. **`seedMessages` má tvar, jaký potřebují testy úkolů 17 až 19** (`statuses`,
 *    `twoCampaignsWithDifferentLists`, `createdMonthsAgo`, `withEvents`) a vrací
 *    identifikátory. Definice v kapitole plánu měla tvar `{ campaignId, count, status }`
 *    a vracela `void`, což se s vlastními testy plánu neslučuje.
 * 6. **Soubor leží v `campaigns/test/`, ne v `src/testing/`.** Plán chtěl
 *    `packages/core/src/testing/harness.ts`. Dva důvody proti. Za prvé `src/testing/` není
 *    ani `campaigns/**`, ani `providers/**`, tedy leží mimo to, co P13 vlastní. Za druhé
 *    `suppressions.query-shape.test.ts` z P07 hlídá, že `INSERT INTO suppressions`
 *    a `UPDATE suppressions` nikde v produkčním kódu nejsou, a z toho pravidla vyjímá
 *    adresáře `test` a `tests`. Harness ty dva příkazy mít musí (seeduje jimi výchozí
 *    stav pro testy záchytné cesty), takže v `src/testing/` shazoval cizí pojistku.
 *    Ověřeno spuštěním: před přesunem hlásila dvě porušení, po přesunu žádné.
 * 7. **`withTestWorkspace` NEZAKLÁDÁ výchozí kontakt.** Plán ho zakládal a vracel jako
 *    `ctx.contactId`. Jenže ten kontakt je aktivní, má platnou adresu a není ukázkový,
 *    takže by prošel materializačním filtrem a připočetl se do publika každé kampaně.
 *    Vlastní testy plánu s ním pak nesedí: úkol 13 čeká u čtyř ukázkových a dvou
 *    běžných kontaktů `inserted === 2` a úkol 15 čeká u sedmi kontaktů `total_count === 7`.
 *    Kdo potřebuje kontakt, zakládá si ho `seedContacts`; `seedMessages` si zakládá vlastní.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createWorkspaceAsUser } from '@mlain/db';
import { createSystemContext } from '../../identity/context';
import { hashPassword } from '../../identity/password';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import {
  appPool,
  closePools,
  withWorkspace,
  withoutContext,
  type WorkspaceContext,
} from '../../tx';
import { rawSql } from '../repo/raw-sql';

export type TestWorkspace = {
  workspace: WorkspaceContext;
  workspaceId: string;
  userId: string;
  /** Aplikacni spojeni pro testy, ktere overuji, ze neco pod mlain_app NEJDE. */
  appClient: Pool;
};

let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let seedUserId = '';
let hasCompileMeta = false;

beforeAll(async () => {
  harness = await startPgHarness();
  await closePools();
  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });

  const { rows } = await migratorPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name = 'campaigns' AND column_name = 'compile_meta'`,
  );
  hasCompileMeta = Number(rows[0]?.n ?? '0') > 0;

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx.execute<{ id: string }>(
      rawSql(
        `INSERT INTO users (email, password_hash, name, locale, timezone)
         VALUES ($1, $2, 'Vlastník', 'cs', 'Europe/Prague') RETURNING id`,
        [`p13-${process.pid}-${Date.now()}@example.cz`, passwordHash],
      ),
    );
    return inserted.rows[0]!.id;
  });
}, 300_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await harness?.stop();
  harness = null;
  migratorPool = null;
}, 120_000);

/**
 * Pool pod migrátorskou rolí. Kontrolní čtení a DDL jde přes něj schválně: nesmí ho
 * ovlivnit tatáž RLS politika, kterou používá testovaný kód.
 */
export function migratorClient(): Pool {
  if (migratorPool === null) throw new Error('migrátorský pool není otevřený');
  return migratorPool;
}

let workspaceCounter = 0;

/** Novy prazdny projekt s vlastnikem. Kazdy test dostane svuj, kontakty si zaseje sam. */
export async function withTestWorkspace(): Promise<TestWorkspace> {
  workspaceCounter += 1;
  const slug = `p13-${process.pid}-${Date.now()}-${workspaceCounter}`.slice(0, 62);
  const created = await createWorkspaceAsUser(appPool(), seedUserId, {
    name: `Kampaně ${workspaceCounter}`,
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });

  // Kontext se stavi TOVARNOU z `identity/context`, ne primym `unsafeWorkspaceContext`.
  // `scope.test.ts` hlida, ze tu funkci importuje jediny soubor v celem balicku, a je
  // to spravne pravidlo: druhy importer je druhe misto, kde se da obejit RLS.
  const workspace = createSystemContext(created.id, 'p13-test-harness');
  return {
    workspace,
    workspaceId: created.id,
    userId: seedUserId,
    appClient: appPool(),
  };
}

export async function seedList(ctx: TestWorkspace, name = 'Seznam'): Promise<string> {
  const id = randomUUID();
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(`INSERT INTO lists (id, workspace_id, name) VALUES ($1, $2, $3)`, [
        id,
        ctx.workspaceId,
        name,
      ]),
    ),
  );
  return id;
}

export type SeedContactsInput = {
  count: number;
  list?: string;
  email?: string;
  attributes?: Record<string, unknown>;
  sourceRef?: string;
  status?: string;
};

export async function seedContacts(
  ctx: TestWorkspace,
  input: SeedContactsInput,
): Promise<string[]> {
  const ids: string[] = [];
  await withWorkspace(ctx.workspace, async (tx) => {
    for (let i = 0; i < input.count; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await tx.execute(
        rawSql(
          `INSERT INTO contacts
             (id, workspace_id, email, first_name, attributes, source_ref, status, email_fingerprints)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, ARRAY[decode(md5(lower($3)), 'hex')])`,
          [
            id,
            ctx.workspaceId,
            input.email && input.count === 1 ? input.email : `c-${id}@example.com`,
            `Jméno${i}`,
            JSON.stringify(input.attributes ?? {}),
            input.sourceRef ?? null,
            input.status ?? 'active',
          ],
        ),
      );
      if (input.list) {
        await tx.execute(
          rawSql(
            `INSERT INTO list_subscriptions (workspace_id, list_id, contact_id, status, source)
             VALUES ($1, $2, $3, 'confirmed', 'manual')`,
            [ctx.workspaceId, input.list, id],
          ),
        );
      }
    }
  });
  return ids;
}

export type SeedCampaignInput = {
  status: string;
  includeLists?: string[];
  subject?: string;
  design?: unknown;
  audienceBuiltAt?: string | null;
  compiled?: boolean;
  presence?: string[];
  providerId?: string;
  unsubscribeListId?: string;
  /**
   * DOPLNĚK FÁZE E (úkol 21). Posun `scheduled_at` proti `now()` v minutách, kladné
   * číslo znamená minulost. Plánovač vybírá výhradně podle `scheduled_at`, takže bez
   * téhle možnosti nejde jeho catch-up okno vůbec otestovat. `ck_campaigns__schedule`
   * u stavu `scheduled` vyžaduje i `schedule_timezone`, proto se plní obojí.
   */
  scheduledMinutesAgo?: number;
};

export async function seedCampaign(ctx: TestWorkspace, input: SeedCampaignInput): Promise<string> {
  const id = randomUUID();
  const audience = {
    include: { lists: input.includeLists ?? [], segments: [] },
    exclude: { lists: [], segments: [] },
  };
  const compileMeta = input.compiled
    ? {
        contractVersion: 1,
        rendererVersion: 'r1.0.0',
        clickMarkerCount: 0,
        links: [],
        usedPaths: input.presence ?? [],
        renderSchema: {
          version: 1,
          fields: (input.presence ?? []).map((p) => ({ path: p, type: 'string', required: false })),
          systemTags: [],
          presence: input.presence ?? [],
          loops: [],
        },
        hasUnsubscribeLink: true,
      }
    : null;

  const metaColumn = hasCompileMeta ? ', compile_meta' : '';
  const metaValue = hasCompileMeta ? ', $10::jsonb' : '';

  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO campaigns
           (id, workspace_id, name, status, subject, audience, audience_built_at,
            design, compiled_html, created_by, unsubscribe_list_id, provider_id,
            scheduled_at, schedule_timezone${metaColumn})
         VALUES ($1, $2, 'Kampaň', $3, $4, $5::jsonb, $6::timestamptz,
                 $7::jsonb, $8, $9, $11, $12,
                 CASE WHEN $13::text IS NULL THEN NULL
                      ELSE now() - ($13 || ' minutes')::interval END,
                 CASE WHEN $13::text IS NULL THEN NULL ELSE 'Europe/Prague' END${metaValue})`,
        [
          id,
          ctx.workspaceId,
          input.status,
          input.subject ?? 'Předmět',
          JSON.stringify(audience),
          input.audienceBuiltAt ?? null,
          JSON.stringify(input.design ?? { version: 1, blocks: [] }),
          input.compiled ? '<p>ok</p>' : null,
          ctx.userId,
          compileMeta ? JSON.stringify(compileMeta) : null,
          input.unsubscribeListId ?? null,
          input.providerId ?? null,
          input.scheduledMinutesAgo === undefined ? null : String(input.scheduledMinutesAgo),
        ],
      ),
    ),
  );
  return id;
}

/**
 * DOPLNĚK FÁZE F (úkol 31) proti podobě z úkolu 2: `isDefault` a `quotaCheckedMinutesAgo`.
 * Bez prvního nejde otestovat, že je na projekt právě jeden výchozí odesílací účet,
 * bez druhého nejde otestovat výběr účtů s nejstarší kontrolou kvóty.
 *
 * `config_public` se plní maskovanou hodnotou, ne prázdným objektem: test „API nikdy
 * nevrací tajemství" se ptá právě na ni a nad `{}` by prošel, i kdyby dotaz vracel klíč.
 */
export async function seedProvider(
  ctx: TestWorkspace,
  input: {
    type?: 'ses' | 'smtp';
    status?: string;
    isDefault?: boolean;
    quotaCheckedMinutesAgo?: number;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const configPublic =
    (input.type ?? 'ses') === 'ses'
      ? {
          kind: 'ses',
          region: 'eu-central-1',
          configuration_set_name: 'mlain-test',
          sns_topic_arn: null,
          access_key_id_masked: 'AKIA****ABCD',
        }
      : {
          kind: 'smtp',
          host: 'smtp.example.cz',
          port: 587,
          encryption: 'starttls',
          username_masked: 'jana****ma.cz',
        };
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO sending_providers
           (id, workspace_id, name, type, config_encrypted, config_public, status,
            is_default, quota_checked_at)
         VALUES ($1, $2, 'Provider', $3, 'enc:test', $5::jsonb, $4, $6,
                 CASE WHEN $7::text IS NULL THEN NULL
                      ELSE now() - ($7 || ' minutes')::interval END)`,
        [
          id,
          ctx.workspaceId,
          input.type ?? 'ses',
          input.status ?? 'ready',
          JSON.stringify(configPublic),
          input.isDefault ?? false,
          input.quotaCheckedMinutesAgo === undefined ? null : String(input.quotaCheckedMinutesAgo),
        ],
      ),
    ),
  );
  return id;
}

/**
 * DOPLNĚK FÁZE E (úkoly 23 a 26). Zprávy v outboxu po stavech.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ OBJEMEM. Podoba z úkolu 2 zakládala kontakt i zprávu
 * jedním `INSERT` na řádek. Test zrušení kampaně jich potřebuje 50 000 a po řádcích
 * by běžel minuty. Vkládá se proto hromadně přes `generate_series`; vznikají tytéž
 * řádky, jen jedním příkazem na stav.
 *
 * `audience_built_at` kampaně se přepisuje na `created_at` zpráv, protože invariant I1
 * je vynucený složeným cizím klíčem a bez toho by vložení skončilo chybou 23503.
 */
export async function seedOutbox(
  ctx: TestWorkspace,
  input: {
    campaignId: string;
    pending?: number;
    sent?: number;
    claimed?: number;
    failed?: number;
    skipped?: number;
    /** Zprávy s `kind = 'test'`. Do publika kampaně nepatří a do `total_count` se nepočítají. */
    testMessages?: number;
    createdAtInRange?: { from: Date };
  },
): Promise<void> {
  const createdAt = (input.createdAtInRange?.from ?? new Date()).toISOString();
  await withWorkspace(ctx.workspace, async (tx) => {
    await tx.execute(
      rawSql(`UPDATE campaigns SET audience_built_at = $2::timestamptz WHERE id = $1`, [
        input.campaignId,
        createdAt,
      ]),
    );

    const groups: Array<{ status: string; kind: 'campaign' | 'test'; n: number }> = [
      { status: 'pending', kind: 'campaign', n: input.pending ?? 0 },
      { status: 'sent', kind: 'campaign', n: input.sent ?? 0 },
      { status: 'claimed', kind: 'campaign', n: input.claimed ?? 0 },
      { status: 'failed', kind: 'campaign', n: input.failed ?? 0 },
      { status: 'skipped', kind: 'campaign', n: input.skipped ?? 0 },
      { status: 'sent', kind: 'test', n: input.testMessages ?? 0 },
    ];

    for (const g of groups) {
      if (g.n === 0) continue;
      await tx.execute(
        rawSql(
          // `email_fingerprints` se tady SCHVÁLNĚ nechává prázdné. Kontakty jsou v téhle
          // funkci jen výplň, aby zpráva měla na co ukazovat (`contact_id` je NOT NULL
          // a `uq_messages__campaign_contact` žádá jiný kontakt na každou zprávu);
          // otisk potřebují jen testy shody se suppression, a ty zakládají kontakty
          // přes `seedContacts` nebo `seedMessages`. Rozdíl je měřitelný: nad GIN
          // indexem `idx_contacts__email_fingerprints` stojí padesát tisíc otisků
          // podstatnou část času celého scénáře.
          `WITH src AS (
             SELECT 'm-' || gen_random_uuid()::text || '@example.com' AS email
               FROM generate_series(1, $5)
           ), ins AS (
             INSERT INTO contacts (workspace_id, email, status)
             SELECT $1, email, 'active' FROM src
             RETURNING id, email
           )
           INSERT INTO messages
             (workspace_id, campaign_id, contact_id, kind, email, status, created_at, sent_at)
           SELECT $1, $2, ins.id, $6, ins.email, $3, $4::timestamptz,
                  CASE WHEN $3 = 'sent' THEN $4::timestamptz END
             FROM ins`,
          [ctx.workspaceId, input.campaignId, g.status, createdAt, g.n, g.kind],
        ),
      );
    }
  });
}

/**
 * DOPLNĚK FÁZE E (úkol 26). Události ke zprávám kampaně.
 *
 * `sameMessage` je nutné, ne pohodlné: dvě události `bounced_soft` k TÉŽE zprávě mají
 * čítač zvednout o jedna, ne o dvě, a bez téhle možnosti by ten test nešlo napsat.
 * `rank` se nezapisuje, je to generovaný sloupec.
 */
export async function seedEvents(
  ctx: TestWorkspace,
  input: { campaignId: string; type: string; count: number; sameMessage?: boolean },
): Promise<void> {
  await withWorkspace(ctx.workspace, async (tx) => {
    const msgs = await tx.execute<{ id: string; created_at: string; contact_id: string }>(
      rawSql(
        `SELECT id, created_at, contact_id FROM messages
          WHERE campaign_id = $1 AND workspace_id = $2 AND kind = 'campaign'
          ORDER BY id
          LIMIT $3`,
        [input.campaignId, ctx.workspaceId, input.sameMessage ? 1 : input.count],
      ),
    );
    for (let i = 0; i < input.count; i += 1) {
      const m = input.sameMessage ? msgs.rows[0] : msgs.rows[i];
      if (!m) break;
      await tx.execute(
        rawSql(
          `INSERT INTO message_events
             (workspace_id, message_id, message_created_at, campaign_id, contact_id,
              recipient, type, ts, source)
           VALUES ($1, $2, $3::timestamptz, $4, $5, 'x@example.com', $6, now(), 'ses_sns')`,
          [ctx.workspaceId, m.id, m.created_at, input.campaignId, m.contact_id, input.type],
        ),
      );
    }
  });
}

export type SeedMessagesInput = {
  /** Stav každé zakládané zprávy. Jedna zpráva na položku. */
  statuses: readonly string[];
  /** Dvě kampaně, každá s jiným `unsubscribe_list_id`. Vrací `listA` a `listB`. */
  twoCampaignsWithDifferentLists?: boolean;
  /** Posune `created_at` zpráv i `audience_built_at` kampaně o N měsíců zpět. */
  createdMonthsAgo?: number;
  /** Doplní ke každé zprávě jednu událost typu `delivered`. */
  withEvents?: boolean;
};

export type SeededMessages = {
  contactId: string;
  email: string;
  campaignId: string;
  listA: string | null;
  listB: string | null;
};

/**
 * Zprávy v outboxu pro jeden kontakt.
 *
 * `audience_built_at` kampaně se plní vždy: složený cizí klíč
 * `fk_messages__campaign_audience` váže `(campaign_id, created_at)` zprávy právě na něj.
 * Je to invariant I1 a bez té hodnoty skončí vložení zprávy chybou 23503.
 */
export async function seedMessages(
  ctx: TestWorkspace,
  input: SeedMessagesInput,
): Promise<SeededMessages> {
  const monthsAgo = input.createdMonthsAgo ?? 0;
  const now = new Date();
  const createdAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 15, 12, 0, 0),
  ).toISOString();

  const contactId = randomUUID();
  const email = `msg-${contactId}@example.com`;

  const listA = input.twoCampaignsWithDifferentLists ? await seedList(ctx, 'Seznam A') : null;
  const listB = input.twoCampaignsWithDifferentLists ? await seedList(ctx, 'Seznam B') : null;

  if (monthsAgo > 0) await ensurePartitions(createdAt);

  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO contacts (id, workspace_id, email, status, email_fingerprints)
         VALUES ($1, $2, $3, 'active', ARRAY[decode(md5(lower($3)), 'hex')])`,
        [contactId, ctx.workspaceId, email],
      ),
    ),
  );

  const campaignA = await seedCampaign(ctx, {
    status: 'sending',
    audienceBuiltAt: createdAt,
    ...(listA ? { unsubscribeListId: listA } : {}),
  });
  const campaigns = [campaignA];
  if (listB) {
    campaigns.push(
      await seedCampaign(ctx, {
        status: 'sending',
        audienceBuiltAt: createdAt,
        unsubscribeListId: listB,
      }),
    );
  }

  await withWorkspace(ctx.workspace, async (tx) => {
    for (const campaignId of campaigns) {
      for (const status of input.statuses) {
        const messageId = randomUUID();
        await tx.execute(
          rawSql(
            `INSERT INTO messages
               (id, workspace_id, campaign_id, contact_id, kind, email, status, created_at, sent_at)
             VALUES ($1, $2, $3, $4, 'campaign', $5, $6, $7::timestamptz,
                     CASE WHEN $6 = 'sent' THEN $7::timestamptz END)`,
            [messageId, ctx.workspaceId, campaignId, contactId, email, status, createdAt],
          ),
        );
        if (input.withEvents) {
          await tx.execute(
            rawSql(
              `INSERT INTO message_events
                 (workspace_id, message_id, message_created_at, campaign_id, contact_id,
                  recipient, type, ts, source)
               VALUES ($1, $2, $3::timestamptz, $4, $5, $6, 'delivered', now(), 'ses_sns')`,
              [ctx.workspaceId, messageId, createdAt, campaignId, contactId, email],
            ),
          );
        }
      }
    }
  });

  return { contactId, email, campaignId: campaignA, listA, listB };
}

/** Oddíly pro měsíc, do kterého spadá `at`. Zakládá je MIGRATOR, mlain_app na CREATE právo nemá. */
async function ensurePartitions(at: string): Promise<void> {
  const from = new Date(at);
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  for (const table of ['messages', 'message_events'] as const) {
    const name = `${table}_y${start.getUTCFullYear()}m${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    await migratorClient().query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table}
         FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
    );
  }
}

export type AddSuppressionInput = { email: string; reason: string; removed?: boolean };

export async function addSuppression(
  ctx: TestWorkspace,
  input: AddSuppressionInput,
): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO suppressions
           (workspace_id, email, fingerprint, fingerprint_key_id, reason, source, removed_at)
         VALUES ($1, $2, decode(md5(lower($2)), 'hex'), 1, $3, 'manual',
                 CASE WHEN $4 THEN now() END)`,
        [ctx.workspaceId, input.email, input.reason, input.removed ?? false],
      ),
    ),
  );
}

/**
 * Simuluje výmaz podle GDPR: plaintext adresy v suppression zmizí, otisk zůstane.
 * Shoda přes adresu tedy přestane platit a musí zabrat větev přes otisk.
 */
export async function anonymizeSuppression(
  ctx: TestWorkspace,
  input: { email: string },
): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `UPDATE suppressions SET email = 'erased+' || id::text || '@erased.invalid'
          WHERE workspace_id = $1 AND lower(email::text) = lower($2)`,
        [ctx.workspaceId, input.email],
      ),
    ),
  );
}

export async function setProgressPhase(
  ctx: TestWorkspace,
  campaignId: string,
  phase: 'collecting' | 'materializing' | 'done',
): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `UPDATE campaign_audience_progress SET phase = $3
          WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId, phase],
      ),
    ),
  );
}
