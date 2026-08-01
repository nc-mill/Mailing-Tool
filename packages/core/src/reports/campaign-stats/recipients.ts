import { sql, type SQL } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { decodeCursor, encodeCursor } from '../cursor';
import { BOUNCE_TYPES } from '../event-types';
import { notFound, validationFailed } from '../errors';

export const RECIPIENT_FILTERS = [
  'all',
  'opened',
  'clicked',
  'not_opened',
  'not_clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'machine_open_only',
] as const;

export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

/** Bity masky tříd otevření podle 2.6 části 5. */
const MASK_HUMAN = 1;
const MASK_PROXY_APPLE = 2;
const MASK_PROXY_IMAGE = 4;

/**
 * Řadí se podle `messages.contact_id` (R20), protože `uq_messages__campaign_contact
 * (campaign_id, contact_id, created_at)` z P03 dává při pevném `campaign_id`
 * přesně tohle uspořádání a zároveň zaručuje jeho jednoznačnost uvnitř kampaně.
 * Podle `messages.id` žádný index není a stránka by se platila setříděním
 * celého měsíčního oddílu.
 */
export const RECIPIENTS_ORDER = 'contact_id.desc';

export type RecipientItem = {
  messageId: string;
  /** null u kontaktu, jehož vazbu odstřihl GDPR výmaz. */
  contactId: string | null;
  email: string | null;
  name: string | null;
  contactState: 'active' | 'deleted' | 'erased';
  firstOpenAt: string | null;
  firstClickAt: string | null;
  openCount: number;
  clickCount: number;
  openReliability: 'confirmed' | 'machine' | null;
};

export type RecipientsPage = {
  items: RecipientItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * Jména typů podle `ck_message_events__type` (R19). Odraz je jeden pojem
 * se dvěma tvrdostmi a obě jsou vlastní typ, ne `subtype`.
 */
const EVENT_FILTERS: Partial<Record<RecipientFilter, readonly string[]>> = {
  bounced: BOUNCE_TYPES,
  complained: ['complained'],
  unsubscribed: ['unsubscribe'],
};

export async function readCampaignRecipients(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; filter: RecipientFilter; limit: number; cursor?: string },
): Promise<RecipientsPage> {
  if (!RECIPIENT_FILTERS.includes(input.filter)) {
    throw validationFailed('filter', 'unknown_recipient_filter', 'Neznámý filtr příjemců.');
  }
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const after = input.cursor ? (decodeCursor(input.cursor, RECIPIENTS_ORDER).k[0] ?? null) : null;

  const { rows: campaignRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT audience_built_at
      FROM campaigns
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${input.campaignId} AND deleted_at IS NULL
  `);
  const campaign = campaignRows[0];
  if (!campaign) throw notFound('campaign');
  // Invariant I1: všechny zprávy kampaně mají created_at rovné audience_built_at.
  // Bez téhle podmínky by dotaz prošel všechny partition messages.
  const partitionKey = (campaign['audience_built_at'] ?? null) as Date | string | null;
  if (partitionKey === null) return { items: [], hasMore: false, nextCursor: null };

  const eventTypes = EVENT_FILTERS[input.filter];
  const rows = eventTypes
    ? await selectByEvents(tx, ctx, input.campaignId, partitionKey, eventTypes, after, limit + 1)
    : await selectByEngagement(
        tx,
        ctx,
        input.campaignId,
        partitionKey,
        input.filter,
        after,
        limit + 1,
      );

  const hasMore = rows.length > limit;
  const kept = rows.slice(0, limit);
  const page = kept.map(toItem);
  // Kurzor nese contact_id z řádku, ne z položky: `RecipientItem.contactId`
  // je u vymazané vazby null a stránkování by se na něm zastavilo.
  const lastRow = kept[kept.length - 1];

  return {
    items: page,
    hasMore,
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({ k: [String(lastRow['cursor_contact_id'])], d: 'n', o: RECIPIENTS_ORDER })
        : null,
  };
}

function engagementPredicate(filter: RecipientFilter): SQL {
  switch (filter) {
    case 'opened':
      return sql`me.first_open_at IS NOT NULL`;
    case 'not_opened':
      return sql`me.first_open_at IS NULL`;
    case 'clicked':
      return sql`me.first_click_at IS NOT NULL`;
    case 'not_clicked':
      return sql`me.first_click_at IS NULL`;
    case 'machine_open_only':
      return sql`(me.open_class_mask & ${MASK_PROXY_APPLE}) <> 0
                 AND (me.open_class_mask & ${MASK_HUMAN | MASK_PROXY_IMAGE}) = 0`;
    default:
      return sql`TRUE`;
  }
}

async function selectByEngagement(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  partitionKey: Date | string,
  filter: RecipientFilter,
  after: string | null,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id AS message_id,
           m.contact_id,
           m.contact_id AS cursor_contact_id,
           c.id AS contact_row_id,
           c.email AS contact_email,
           c.first_name,
           c.last_name,
           c.deleted_at,
           c.anonymized_at,
           c.status AS contact_status,
           me.first_open_at,
           me.first_click_at,
           me.first_human_open_at,
           me.open_count,
           me.click_count,
           me.open_class_mask,
           me.erased_at
      FROM messages m
      LEFT JOIN message_engagement me
             ON me.message_id = m.id AND me.created_at = m.created_at
      LEFT JOIN contacts c
             ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
     WHERE m.workspace_id = ${ctx.workspaceId}
       AND m.campaign_id  = ${campaignId}
       AND m.created_at   = ${partitionKey}
       AND ${engagementPredicate(filter)}
       AND (${after}::uuid IS NULL OR m.contact_id < ${after}::uuid)
     ORDER BY m.contact_id DESC
     LIMIT ${limit}
  `);
  return rows;
}

/**
 * Odrazy, stížnosti a odhlášení jsou v message_events, ne v engagementu.
 * Seskupení podle zprávy je nutné: jedna zpráva může mít měkký i tvrdý odraz
 * a v seznamu příjemců patří jednou.
 *
 * `sql.param` u pole je POVINNÝ. Holé pole vložené do šablony `sql` Drizzle
 * rozloží na jednotlivé parametry, takže `= ANY($1, $2)` je syntaktická chyba
 * a dotaz spadne při prvním použití. S `sql.param` se pole předá jako jedna
 * hodnota a přetypování `::text[]` řekne ovladači, co s ní.
 */
async function selectByEvents(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  partitionKey: Date | string,
  types: readonly string[],
  after: string | null,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id AS message_id,
           m.contact_id,
           m.contact_id AS cursor_contact_id,
           c.id AS contact_row_id,
           c.email AS contact_email,
           c.first_name,
           c.last_name,
           c.deleted_at,
           c.anonymized_at,
           c.status AS contact_status,
           me.first_open_at,
           me.first_click_at,
           me.first_human_open_at,
           me.open_count,
           me.click_count,
           me.open_class_mask,
           me.erased_at
      FROM message_events e
      JOIN messages m
        ON m.id = e.message_id AND m.created_at = e.message_created_at
      LEFT JOIN message_engagement me
             ON me.message_id = m.id AND me.created_at = m.created_at
      LEFT JOIN contacts c
             ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.campaign_id  = ${campaignId}
       AND e.type         = ANY(${sql.param([...types])}::text[])
       AND e.received_at >= ${partitionKey}
       AND m.created_at   = ${partitionKey}
       AND (${after}::uuid IS NULL OR m.contact_id < ${after}::uuid)
     GROUP BY m.id, m.contact_id, m.created_at, c.id, c.email, c.first_name, c.last_name,
              c.deleted_at, c.anonymized_at, c.status, me.first_open_at, me.first_click_at,
              me.first_human_open_at, me.open_count, me.click_count,
              me.open_class_mask, me.erased_at
     ORDER BY m.contact_id DESC
     LIMIT ${limit}
  `);
  return rows;
}

function toItem(row: Record<string, unknown>): RecipientItem {
  const erasedInTracking = row['erased_at'] !== null && row['erased_at'] !== undefined;
  // P07 kontakt anonymizuje, tedy řádek nechá a osobní údaje z něj vymaže.
  // Pro report je to totéž jako výmaz vazby: údaje nejsou, čísla platí.
  const anonymized = row['anonymized_at'] !== null && row['anonymized_at'] !== undefined;
  const contactMissing = row['contact_row_id'] === null || row['contact_row_id'] === undefined;
  const softDeleted =
    row['deleted_at'] !== null && row['deleted_at'] !== undefined
      ? true
      : row['contact_status'] === 'deleted';

  const contactState: RecipientItem['contactState'] =
    erasedInTracking || anonymized
      ? 'erased'
      : contactMissing || softDeleted
        ? 'deleted'
        : 'active';

  const visible = contactState === 'active';
  const firstName = typeof row['first_name'] === 'string' ? row['first_name'] : '';
  const lastName = typeof row['last_name'] === 'string' ? row['last_name'] : '';
  const name = `${firstName} ${lastName}`.trim();

  return {
    messageId: String(row['message_id']),
    // Anonymizovaný kontakt si ID nechává: v aplikaci na něj jde prokliknout
    // a uvidí se, že takový člověk existoval. Vymazaná vazba ID nemá.
    contactId: erasedInTracking || contactMissing ? null : String(row['contact_id']),
    email: visible && typeof row['contact_email'] === 'string' ? row['contact_email'] : null,
    name: visible && name.length > 0 ? name : null,
    contactState,
    firstOpenAt: toIso(row['first_open_at']),
    firstClickAt: toIso(row['first_click_at']),
    openCount: Number(row['open_count'] ?? 0),
    clickCount: Number(row['click_count'] ?? 0),
    openReliability: openReliability(row),
  };
}

function openReliability(row: Record<string, unknown>): RecipientItem['openReliability'] {
  if (row['first_open_at'] === null || row['first_open_at'] === undefined) return null;
  return row['first_human_open_at'] ? 'confirmed' : 'machine';
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
