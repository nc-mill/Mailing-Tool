import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import type { InboundMapping } from '../inbound/mapping';

export type DeliveryStatus = 'received' | 'processed' | 'unmapped' | 'ignored' | 'failed';

export type DeliveryRef = {
  workspaceId: string;
  deliveryId: string;
  /** Druhá složka klíče partitionované tabulky. Bez ní projde dotaz všemi oddíly. */
  createdAt: string;
};

export type DeliveryWithMapping = {
  status: DeliveryStatus;
  endpointId: string;
  externalId: string | null;
  payload: unknown;
  mapping: InboundMapping;
};

/**
 * Načte doručení i mapování jeho endpointu jedním dotazem.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ SCHÉMATEM. Plán se ptá na sloupec `received_at`.
 * `inbound_deliveries` má podle P03 sloupec `created_at` a partiční klíč
 * `(id, created_at)`; dotaz podle plánu by skončil na `42703 column does not exist`.
 */
export async function loadDelivery(
  ctx: WorkspaceContext,
  ref: DeliveryRef,
): Promise<DeliveryWithMapping | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      status: DeliveryStatus;
      endpoint_id: string;
      external_id: string | null;
      payload: unknown;
      mapping: InboundMapping;
    }>(sql`
      SELECT d.status, d.endpoint_id, d.external_id, d.payload, e.mapping
        FROM inbound_deliveries d
        JOIN inbound_endpoints e ON e.id = d.endpoint_id
       WHERE d.workspace_id = ${ref.workspaceId}::uuid
         AND d.id = ${ref.deliveryId}::uuid
         AND d.created_at = ${ref.createdAt}::timestamptz
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      status: row.status,
      endpointId: row.endpoint_id,
      externalId: row.external_id,
      payload: row.payload,
      mapping: row.mapping ?? {},
    };
  });
}

/**
 * Přepne stav doručení PODMÍNĚNĚ ze stavu 'received'.
 *
 * Podmínka je celá idempotence: druhý běh po pádu workeru neovlivní žádný řádek
 * a nepřepíše výsledek prvního běhu. Bez ní by opakované doručení od e-shopu
 * přepsalo stav 'processed' zpátky na 'unmapped'.
 */
export async function markDelivery(
  ctx: WorkspaceContext,
  ref: DeliveryRef,
  status: Exclude<DeliveryStatus, 'received'>,
  detail: { errorCode?: string | null; contactId?: string | null; action?: string | null } = {},
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rowCount } = await tx.execute(sql`
      UPDATE inbound_deliveries
         SET status = ${status}, error_code = ${detail.errorCode ?? null},
             contact_id = coalesce(${detail.contactId ?? null}::uuid, contact_id),
             action = coalesce(${detail.action ?? null}, action),
             processed_at = now()
       WHERE workspace_id = ${ref.workspaceId}::uuid
         AND id = ${ref.deliveryId}::uuid
         AND created_at = ${ref.createdAt}::timestamptz
         AND status = 'received'
    `);
    return (rowCount ?? 0) > 0;
  });
}

export type RecordDeliveryInput = {
  endpointId: string;
  externalId: string | null;
  payload: unknown;
  headers: Record<string, string>;
};

/**
 * Uloží doručení ve stavu `received`. Volá se v HTTP obsluze hned po ověření podpisu,
 * ještě před mapováním: chyby mapování se nesmí promítnout do odpovědi, jinak by je
 * e-shop opakoval donekonečna.
 *
 * Dedup podle `external_id` je druhá vrstva vedle časového razítka v podpisu. Když už
 * doručení s týmž identifikátorem existuje, vrátí se původní a nový řádek nevznikne.
 */
export async function recordDelivery(
  ctx: WorkspaceContext,
  input: RecordDeliveryInput,
): Promise<{ deliveryId: string; createdAt: string; duplicate: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    if (input.externalId !== null) {
      const existing = await tx.execute<{ delivery_id: string; delivery_created_at: string }>(sql`
        SELECT delivery_id, delivery_created_at FROM inbound_dedup
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND endpoint_id = ${input.endpointId}::uuid
           AND external_id = ${input.externalId}
      `);
      const found = existing.rows[0];
      if (found !== undefined) {
        return {
          deliveryId: found.delivery_id,
          createdAt: new Date(found.delivery_created_at).toISOString(),
          duplicate: true,
        };
      }
    }

    const inserted = await tx.execute<{ id: string; created_at: string }>(sql`
      INSERT INTO inbound_deliveries (workspace_id, endpoint_id, external_id, status,
                                      payload, headers)
      VALUES (${ctx.workspaceId}::uuid, ${input.endpointId}::uuid, ${input.externalId},
              'received', ${JSON.stringify(input.payload ?? {})}::jsonb,
              ${JSON.stringify(input.headers)}::jsonb)
      RETURNING id, created_at
    `);
    const row = inserted.rows[0]!;
    const createdAt = new Date(row.created_at).toISOString();

    if (input.externalId !== null) {
      await tx.execute(sql`
        INSERT INTO inbound_dedup (workspace_id, endpoint_id, external_id, delivery_id,
                                   delivery_created_at)
        VALUES (${ctx.workspaceId}::uuid, ${input.endpointId}::uuid, ${input.externalId},
                ${row.id}::uuid, ${createdAt}::timestamptz)
        ON CONFLICT ON CONSTRAINT pk_inbound_dedup DO NOTHING
      `);
    }

    return { deliveryId: row.id, createdAt, duplicate: false };
  });
}

export type InboundEndpointRow = {
  id: string;
  workspaceId: string;
  slug: string;
  signatureMode: 'none' | 'hmac_sha256' | 'shared_secret' | 'basic';
  signatureConfig: Record<string, unknown>;
  secretEncrypted: string | null;
  mapping: InboundMapping;
  active: boolean;
};

/** Endpoint podle slugu v rámci projektu. Projekt se bere z veřejného odkazu, viz `public/ids.ts`. */
export async function findEndpointBySlug(
  ctx: WorkspaceContext,
  slug: string,
  tx?: Tx,
): Promise<InboundEndpointRow | null> {
  const run = async (handle: Tx): Promise<InboundEndpointRow | null> => {
    const { rows } = await handle.execute<{
      id: string;
      workspace_id: string;
      slug: string;
      signature_mode: InboundEndpointRow['signatureMode'];
      signature_config: Record<string, unknown>;
      secret_encrypted: string | null;
      mapping: InboundMapping;
      active: boolean;
    }>(sql`
      SELECT id, workspace_id, slug, signature_mode, signature_config, secret_encrypted,
             mapping, active
        FROM inbound_endpoints
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND slug = ${slug}
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      slug: row.slug,
      signatureMode: row.signature_mode,
      signatureConfig: row.signature_config ?? {},
      secretEncrypted: row.secret_encrypted,
      mapping: row.mapping ?? {},
      active: row.active,
    };
  };
  return tx === undefined ? withWorkspace(ctx, run) : run(tx);
}
