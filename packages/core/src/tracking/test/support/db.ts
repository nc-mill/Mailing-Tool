import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { hashPassword } from '../../../identity/password';
import { startPgHarness, type PgHarness } from '../../../test-support/pg-harness';
import { appPool, closePools, withoutContext } from '../../../tx';

/**
 * Bootstrap databázových testů domény trackingu.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán stavěl na `withTestDatabase()`,
 * `seedWorkspace()`, `seedCampaign()` a `seedMessage()` z `@mlain/db/testing`.
 * Balíček `@mlain/db` takový klíč v `exports` nemá a mít ho zatím nebude,
 * protože ten řádek vlastní P03. Používá se proto `startPgHarness()` z
 * `packages/core/src/test-support/pg-harness.ts`, tedy hotový harness, pod
 * kterým dnes běží databázové testy identity, kontaktů, auditu i platformy,
 * a seedy jsou tady.
 */
let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let seedUserId = '';

beforeAll(async () => {
  harness = await startPgHarness();
  await closePools();
  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx
      .insert(schema.users)
      .values({
        email: `tracking-${process.pid}-${Date.now()}@example.cz`,
        passwordHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return inserted[0]!.id;
  });
}, 300_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await harness?.stop();
  harness = null;
}, 120_000);

/**
 * Pool pod migrátorskou rolí. Kontrolní čtení jde přes něj schválně: nesmí ho
 * ovlivnit tatáž RLS politika, kterou používá testovaný kód, jinak by test
 * potvrdil izolaci sám sobě.
 */
export function asMigrator(): Pool {
  if (migratorPool === null) throw new Error('migrátorský pool není otevřený');
  return migratorPool;
}

let workspaceCounter = 0;

/** Čerstvý projekt pro jeden test. Vrací jeho ID. */
export async function seedWorkspace(): Promise<string> {
  workspaceCounter += 1;
  const slug = `trk-${process.pid}-${Date.now()}-${workspaceCounter}`.slice(0, 62);
  const workspace = await createWorkspaceAsUser(appPool(), seedUserId, {
    name: `Tracking ${workspaceCounter}`,
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  return workspace.id;
}

export type SeededCampaign = { workspaceId: string; campaignId: string };

/**
 * Kampaň v novém projektu. Zápis jde přes migrátorský pool, protože seed je
 * příprava dat, ne testovaná cesta.
 *
 * `audience_built_at` se plní schválně: cizí klíč `fk_messages__campaign_audience`
 * váže dvojici (campaign_id, created_at) zprávy právě na něj. Je to invariant I1,
 * tedy „všechny zprávy jednoho materializačního běhu mají stejné created_at".
 * Bez té hodnoty skončí vložení zprávy chybou cizího klíče.
 */
export async function seedCampaign(audienceBuiltAt: Date | null = null): Promise<SeededCampaign> {
  const workspaceId = await seedWorkspace();
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO campaigns (workspace_id, name, audience_built_at) VALUES ($1, $2, $3) RETURNING id`,
    [workspaceId, 'Trackovaná kampaň', audienceBuiltAt],
  );
  return { workspaceId, campaignId: rows[0]!.id };
}

export type SeedMessageInput = {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  createdAt: Date;
  sentAt?: Date | null;
};

/** Zpráva s pevným `created_at`, tedy s druhou složkou primárního klíče. */
export async function seedMessage(input: SeedMessageInput): Promise<string> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at, sent_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'sent') RETURNING id`,
    [
      input.workspaceId,
      input.campaignId,
      input.contactId,
      'prijemce@example.cz',
      input.createdAt,
      input.sentAt ?? null,
    ],
  );
  return rows[0]!.id;
}

export type SeedCampaignLinkInput = {
  workspaceId: string;
  campaignId: string;
  linkId: string;
  url: string;
  position: number;
};

/** Odkaz kampaně. `id` je UUIDv5 z kampaně a URL, proto se vkládá zvenčí. */
export async function seedCampaignLink(input: SeedCampaignLinkInput): Promise<void> {
  await asMigrator().query(
    `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.linkId, input.workspaceId, input.campaignId, input.url, input.position],
  );
}

/** Plán dotazu z EXPLAIN, slepený do jednoho řetězce. */
export async function explain(query: string, params: readonly unknown[]): Promise<string> {
  const { rows } = await asMigrator().query<{ 'QUERY PLAN': string }>(
    `EXPLAIN ${query}`,
    params as unknown[],
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}
