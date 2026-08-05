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
    /** Zkompilovaná podoba. Bez ní zůstávají sloupce NULL, tedy nezkompilovaná kampaň. */
    compiledHtml?: string;
    compiledText?: string;
    /** Dokument kampaně. Podle něj se pozná, jestli e-mail nesl obsah, nebo jen patičku. */
    design?: unknown;
  } = {},
): Promise<SeededCampaign> {
  const campaignId = randomUUID();
  const audienceBuiltAt = options.audienceBuiltAt ?? new Date('2026-07-31T12:00:00.000Z');
  const providerId = await seedProvider(db, workspaceId, options.providerType ?? 'ses');
  await db.pool.query(
    `INSERT INTO campaigns
       (id, workspace_id, name, status, subject, track_opens, track_clicks,
        audience_built_at, provider_id, started_at,
        compiled_html, compiled_text, compiled_at, design)
     VALUES ($1, $2, 'Letní výprodej', $3, 'Sleva 30 %', $4, $5, $6, $7, $6,
             $8, $9, CASE WHEN $8::text IS NULL THEN NULL ELSE $6::timestamptz END, $10)`,
    [
      campaignId,
      workspaceId,
      options.status ?? 'sent',
      options.trackOpens ?? true,
      options.trackClicks ?? true,
      audienceBuiltAt,
      providerId,
      options.compiledHtml ?? null,
      options.compiledText ?? null,
      options.design === undefined ? null : JSON.stringify(options.design),
    ],
  );
  await ensurePartitions(db, audienceBuiltAt);
  return { campaignId, audienceBuiltAt, providerId };
}

/**
 * Odeslaná zpráva i s daty, se kterými ji odesílač vyrenderoval.
 *
 * `render_data` je NOT NULL s výchozí `{}`, ale píše se vždycky explicitně:
 * náhled odeslané podoby stojí právě na ní a test, který ji vynechá, by měřil
 * něco jiného než provoz. `created_at` musí padnout do existujícího oddílu,
 * proto se váže na `audience_built_at` kampaně (viz `ensurePartitions`).
 */
export async function seedMessage(
  db: TestDatabase,
  input: {
    workspaceId: string;
    campaignId: string;
    contactId: string;
    email: string;
    createdAt: Date;
    sentAt?: Date | null;
    renderData?: Record<string, unknown>;
  },
): Promise<string> {
  const messageId = randomUUID();
  await db.pool.query(
    `INSERT INTO messages
       (id, workspace_id, campaign_id, contact_id, email, render_data, status, created_at, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      messageId,
      input.workspaceId,
      input.campaignId,
      input.contactId,
      input.email,
      JSON.stringify(input.renderData ?? {}),
      input.sentAt === null ? 'pending' : 'sent',
      input.createdAt,
      input.sentAt === undefined ? input.createdAt : input.sentAt,
    ],
  );
  return messageId;
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

/**
 * Řádek `web_events`. Zapisuje se přímo, protože testy reportů popisují ČTENÍ:
 * cesta zápisu (příjem `/e/**`, job zapojení, slučování identit) má vlastní
 * testy v doméně měření a protahovat ji sem by z testu čtení udělalo test
 * všeho ostatního.
 *
 * `received_at` se drží u `occurred_at`, jinak řádek spadne na
 * `ck_web_events__lag` (živý zdroj smí mít rozestup nejvýš sedm dní zpět
 * a minutu dopředu) nebo padne do oddílu, který test nezaložil.
 */
export async function seedWebEvent(
  db: TestDatabase,
  input: {
    workspaceId: string;
    name: string;
    occurredAt: Date;
    source?: 'web' | 'email' | 'server' | 'automation' | 'import';
    contactId?: string | null;
    anonymousId?: string | null;
    sessionId?: string | null;
    page?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await ensurePartitions(db, input.occurredAt);
  await db.pool.query(
    `INSERT INTO web_events
       (id, received_at, occurred_at, workspace_id, name, source,
        contact_id, anonymous_id, session_id, page, properties)
     VALUES (gen_random_uuid(), $1, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.occurredAt,
      input.workspaceId,
      input.name,
      input.source ?? 'web',
      input.contactId ?? null,
      input.anonymousId ?? null,
      input.sessionId ?? null,
      JSON.stringify(input.page ?? {}),
      JSON.stringify(input.properties ?? {}),
    ],
  );
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
    /**
     * Volné pole události. U prokliku na systémový odkaz v něm stojí
     * `system_link` a je to jediné místo, ze kterého se pozná, KAM příjemce
     * klikl: takový proklik `link_id` nemá a mít nemůže.
     */
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const ts = input.ts ?? input.messageCreatedAt;
  const receivedAt = input.receivedAt ?? ts;
  const source = input.source ?? (DELIVERY_FAMILY.has(input.type) ? 'ses_sns' : 'tracking');
  const recipient = input.recipient ?? (DELIVERY_FAMILY.has(input.type) ? 'x@example.cz' : null);

  await db.pool.query(
    `INSERT INTO message_events
       (id, received_at, ts, workspace_id, message_id, message_created_at,
        campaign_id, contact_id, type, subtype, recipient, link_id, source, metadata)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
