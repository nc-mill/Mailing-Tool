import { randomUUID } from 'node:crypto';
import { ensurePartitionsForRange } from '@mlain/db/partitions';
import type { TestDatabase } from './db';

export type SeededWorkspace = { workspaceId: string; slug: string };
export type SeededCampaign = {
  campaignId: string;
  audienceBuiltAt: Date;
  providerId: string;
};

export async function seedWorkspace(db: TestDatabase): Promise<SeededWorkspace> {
  const workspaceId = randomUUID();
  const slug = `ws-${workspaceId.slice(0, 8)}`;
  await db.pool.query(
    `INSERT INTO workspaces (id, name, slug, timezone) VALUES ($1, $2, $3, 'Europe/Prague')`,
    [workspaceId, 'Testovací projekt', slug],
  );
  return { workspaceId, slug };
}

export async function seedProvider(
  db: TestDatabase,
  workspaceId: string,
  type: 'ses' | 'smtp',
): Promise<string> {
  const providerId = randomUUID();
  await db.pool.query(
    `INSERT INTO sending_providers (id, workspace_id, name, type, config_encrypted, status)
     VALUES ($1, $2, $3, $4, 'enc:v1:test', 'ready')`,
    [providerId, workspaceId, `provider-${type}`, type],
  );
  return providerId;
}

export async function seedCampaign(
  db: TestDatabase,
  workspaceId: string,
  options: {
    status?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
    providerType?: 'ses' | 'smtp';
    audienceBuiltAt?: Date;
  } = {},
): Promise<SeededCampaign> {
  const campaignId = randomUUID();
  const audienceBuiltAt = options.audienceBuiltAt ?? new Date('2026-07-31T12:00:00.000Z');
  const providerId = await seedProvider(db, workspaceId, options.providerType ?? 'ses');
  await db.pool.query(
    `INSERT INTO campaigns
       (id, workspace_id, name, status, subject, track_opens, track_clicks,
        audience_built_at, provider_id, started_at)
     VALUES ($1, $2, 'Letní výprodej', $3, 'Sleva 30 %', $4, $5, $6, $7, $6)`,
    [
      campaignId,
      workspaceId,
      options.status ?? 'sent',
      options.trackOpens ?? true,
      options.trackClicks ?? true,
      audienceBuiltAt,
      providerId,
    ],
  );
  await ensurePartitions(db, audienceBuiltAt);
  return { campaignId, audienceBuiltAt, providerId };
}

/**
 * Vytvoří měsíční oddíly pro daný měsíc u všech partitionovaných tabulek, které reporty čtou.
 *
 * ODCHYLKA OD PLÁNU. Plán zakládal oddíly ručně přes
 * `CREATE TABLE ... PARTITION OF ... FOR VALUES FROM ($1) TO ($2)`. PostgreSQL
 * v DDL parametry nepřijímá a zápis skončí na „bind message supplies
 * 2 parameters, but prepared statement requires 0". Ověřeno spuštěním.
 * Používá se proto `ensurePartitionsForRange` z `@mlain/db/partitions`, tedy
 * tentýž kód, kterým oddíly zakládá migrační runner: drží stejné pojmenování
 * (a tedy nevyrábí překryvy s oddíly z migrací) i pravidlo z rozhodnutí R20,
 * že oddíl nedostává žádný grant.
 *
 * Zakládá se schválně minulý měsíc. `runMigrations` zakládá aktuální měsíc
 * a tři dopředu, kdežto fixtures pracují s `audience_built_at` v červenci 2026.
 */
export async function ensurePartitions(db: TestDatabase, at: Date): Promise<void> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const tables: Array<[string, string]> = [
    ['messages', 'created_at'],
    ['message_events', 'received_at'],
    ['message_engagement', 'created_at'],
    ['web_events', 'received_at'],
  ];
  for (const [table, column] of tables) {
    await ensurePartitionsForRange(db.pool, table, column, start, end);
  }
}

export async function seedContact(
  db: TestDatabase,
  workspaceId: string,
  options: {
    email?: string;
    firstName?: string;
    lastName?: string;
    gender?: 'female' | 'male' | 'unknown';
  } = {},
): Promise<string> {
  const contactId = randomUUID();
  await db.pool.query(
    `INSERT INTO contacts (id, workspace_id, email, first_name, last_name, gender)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      contactId,
      workspaceId,
      options.email ?? `k-${contactId.slice(0, 8)}@example.cz`,
      options.firstName ?? 'Jana',
      options.lastName ?? 'Nováková',
      options.gender ?? 'female',
    ],
  );
  return contactId;
}

export async function seedCampaignStats(
  db: TestDatabase,
  workspaceId: string,
  campaignId: string,
  values: Record<string, number>,
): Promise<void> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 3}`);
  // ON CONFLICT (campaign_id): PK campaign_stats je jednosloupcový, viz P03.
  //
  // ODCHYLKA OD PLÁNU: `version` se nastavuje i při vložení, ne až při konfliktu.
  // Sloupec má DEFAULT 0, takže první seed by nechal verzi na nule a `ETag`
  // z ní odvozený by u čerstvě naplněné agregace vypadal jako u prázdné.
  // Zapisovatel verzi zvyšuje při KAŽDÉM zápisu, včetně prvního.
  await db.pool.query(
    `INSERT INTO campaign_stats (workspace_id, campaign_id, version${columns.length ? ', ' + columns.join(', ') : ''})
     VALUES ($1, $2, 1${placeholders.length ? ', ' + placeholders.join(', ') : ''})
     ON CONFLICT (campaign_id) DO UPDATE SET ${columns
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')}, version = campaign_stats.version + 1, updated_at = now()`,
    [workspaceId, campaignId, ...columns.map((c) => values[c])],
  );
}

/** Rodina doručovacích typů, u které `ck_message_events__recipient` vyžaduje adresu. */
const DELIVERY_FAMILY = new Set([
  'sent',
  'rejected',
  'delivered',
  'delivery_delayed',
  'bounced_hard',
  'bounced_soft',
  'complained',
  'render_failed',
]);

/**
 * Jediný zapisovač událostí v celém plánu. Existuje proto, že `message_events`
 * má tři pasti, na které se naráží až za běhu:
 *
 *  1. `source` je NOT NULL BEZ výchozí hodnoty a drží ho `ck_message_events__source`
 *     s výčtem `ses_sns`, `smtp`, `internal`, `tracking`. Vynechaný sloupec = 23502.
 *  2. `recipient` je nepovinný, ale `ck_message_events__recipient` ho vyžaduje
 *     pro celou doručovací rodinu. `delivered` bez adresy skončí chybou 23514,
 *     `open` bez adresy projde. Ověřeno v P03 spuštěním.
 *  3. `rank` je GENERATED ALWAYS ... STORED (rozhodnutí R32 v P03). Uvést ho
 *     v seznamu sloupců je chyba 428C9, ne jen zbytečnost.
 */
export async function seedMessageEvent(
  db: TestDatabase,
  input: {
    workspaceId: string;
    campaignId: string;
    messageId: string;
    messageCreatedAt: Date | string;
    contactId: string | null;
    type: string;
    subtype?: string | null;
    ts?: Date | string;
    receivedAt?: Date | string;
    recipient?: string;
    linkId?: string | null;
    source?: 'ses_sns' | 'smtp' | 'internal' | 'tracking';
  },
): Promise<void> {
  const ts = input.ts ?? input.messageCreatedAt;
  const receivedAt = input.receivedAt ?? ts;
  const source = input.source ?? (DELIVERY_FAMILY.has(input.type) ? 'ses_sns' : 'tracking');
  const recipient = input.recipient ?? (DELIVERY_FAMILY.has(input.type) ? 'x@example.cz' : null);

  await db.pool.query(
    `INSERT INTO message_events
       (id, received_at, ts, workspace_id, message_id, message_created_at,
        campaign_id, contact_id, type, subtype, recipient, link_id, source)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      receivedAt,
      ts,
      input.workspaceId,
      input.messageId,
      input.messageCreatedAt,
      input.campaignId,
      input.contactId,
      input.type,
      input.subtype ?? null,
      recipient,
      input.linkId ?? null,
      source,
    ],
  );
}
