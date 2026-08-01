import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type MessageRow = {
  id: string;
  createdAt: Date;
  campaignId: string;
  contactId: string | null;
  workspaceId: string;
  sentAt: Date | null;
};

/**
 * Obě složky primárního klíče zprávy plus projekt z ověřeného tokenu.
 * Pojmenovaný typ kvůli pravidlu z `identity/scope.test.ts`.
 */
export type MessageLookupKey = {
  workspaceId: string;
  messageId: string;
  /** Unixové sekundy z tokenu. Lokátor partition. */
  createdAtSeconds: number;
};

/** Rovnostní dotaz podle obou složek primárního klíče. Jedna partition, jeden Index Scan. */
export async function selectMessageExact(key: MessageLookupKey): Promise<MessageRow | null> {
  return withTrackingTx(
    { workspaceId: key.workspaceId, job: 'tracking.message_lookup' },
    async (tx) => {
      const { rows } = await tx.execute<MessageRow>(sql`
        SELECT id, created_at AS "createdAt", campaign_id AS "campaignId",
               contact_id AS "contactId", workspace_id AS "workspaceId", sent_at AS "sentAt"
          FROM messages
         WHERE id = ${key.messageId}
           AND created_at = to_timestamp(${key.createdAtSeconds})
           AND workspace_id = ${key.workspaceId}
      `);
      return rows[0] ?? null;
    },
  );
}

/**
 * Fallback pro zaokrouhlení na hranici sekundy. Pořád nejvýš dvě partition.
 * Dotaz bez podmínky na created_at se tady nesmí objevit nikdy.
 */
export async function selectMessageNear(key: MessageLookupKey): Promise<MessageRow | null> {
  return withTrackingTx(
    { workspaceId: key.workspaceId, job: 'tracking.message_lookup' },
    async (tx) => {
      const { rows } = await tx.execute<MessageRow>(sql`
        SELECT id, created_at AS "createdAt", campaign_id AS "campaignId",
               contact_id AS "contactId", workspace_id AS "workspaceId", sent_at AS "sentAt"
          FROM messages
         WHERE id = ${key.messageId}
           AND workspace_id = ${key.workspaceId}
           AND created_at >= to_timestamp(${key.createdAtSeconds}) - interval '1 second'
           AND created_at <  to_timestamp(${key.createdAtSeconds}) + interval '2 seconds'
         LIMIT 1
      `);
      return rows[0] ?? null;
    },
  );
}

/** Cíl přesměrování a jeho kampaň. campaign_links není partitionovaná. */
export type CampaignLinkRow = {
  id: string;
  url: string;
  campaignId: string;
  workspaceId: string;
  position: number;
};

export type CampaignLinkLookup = { workspaceId: string; linkId: string };

/**
 * Všechny odkazy kampaně, do které patří zadané `link_id`. Cache se plní po
 * celých kampaních, protože kdo klikl na jeden odkaz v mailu, klikne
 * pravděpodobně i na další.
 */
export async function selectCampaignLinksByLinkId(
  lookup: CampaignLinkLookup,
): Promise<CampaignLinkRow[]> {
  return withTrackingTx(
    { workspaceId: lookup.workspaceId, job: 'tracking.link_cache' },
    async (tx) =>
      (
        await tx.execute<CampaignLinkRow>(sql`
          SELECT id, url, campaign_id AS "campaignId", workspace_id AS "workspaceId", position
            FROM campaign_links
           WHERE campaign_id = (SELECT campaign_id FROM campaign_links WHERE id = ${lookup.linkId})
        `)
      ).rows,
  );
}
