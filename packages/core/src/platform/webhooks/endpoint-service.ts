import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { encryptEnvelope } from '@mlain/contracts/crypto';
import type { Tx } from '../../tx';
import { ApiError, validationFailed } from '../../errors/api-error';
import { writeAuditLog } from '../../audit/write';
import { diffForAudit } from '../../audit/redact';
import { IdentityAuditActions } from '../../identity/audit';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import { assertUrlAllowed, SsrfBlockedError, WEBHOOK_SSRF_POLICY } from '../../net/ssrf';
import { rejectUnknownEventTypes } from './event-catalog';
import { generateWebhookSecret } from './signature';

/** 3.8, tabulka limitů. */
export const MAX_ENDPOINTS_PER_WORKSPACE = 20;
export const MAX_EVENT_TYPES_PER_ENDPOINT = 50;

export type PublicWebhookEndpoint = {
  id: string;
  url: string;
  description: string;
  event_types: string[];
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
};

function toPublic(row: {
  id: string;
  url: string;
  description: string;
  eventTypes: string[];
  status: string;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
}): PublicWebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    event_types: row.eventTypes,
    status: row.status as 'active' | 'disabled',
    disabled_reason: row.disabledReason,
    consecutive_failures: row.consecutiveFailures,
    last_success_at: row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
    last_failure_at: row.lastFailureAt ? new Date(row.lastFailureAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

/** Adresa se kontroluje už při ukládání, i když jediná spolehlivá kontrola je až při doručení. */
function assertTargetAllowed(url: string): void {
  try {
    assertUrlAllowed(url, WEBHOOK_SSRF_POLICY);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw validationFailed([
        {
          path: 'url',
          code: 'blocked_target',
          message: 'Na tuhle adresu webhook posílat nejde. Použijte veřejnou https adresu.',
        },
      ]);
    }
    throw err;
  }
}

/**
 * Kontrola odebíraných typů proti katalogu. Pravidla i s důvody drží
 * `rejectUnknownEventTypes` v `event-catalog.ts`, tady se z nálezu jen dělá
 * chyba API.
 */
function assertEventTypesKnown(types: readonly string[], alreadyStored: readonly string[]): void {
  const rejection = rejectUnknownEventTypes(types, alreadyStored);
  if (rejection === null) return;
  throw validationFailed(rejection.issues, { params: rejection.params });
}

export async function listEndpoints(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<PublicWebhookEndpoint[]> {
  const rows = await tx
    .select()
    .from(schema.webhookEndpoints)
    .where(and(wsEq(ctx, schema.webhookEndpoints), isNull(schema.webhookEndpoints.deletedAt)))
    .orderBy(desc(schema.webhookEndpoints.createdAt));
  return rows.map(toPublic);
}

export async function getEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<PublicWebhookEndpoint> {
  const [row] = await tx
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError('not_found');
  return toPublic(row);
}

export async function createEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  // `| undefined` u volitelných polí je kvůli `exactOptionalPropertyTypes: true`
  // v tsconfigu monorepa: zod z `.optional()` vydává právě takový typ a bez toho
  // by handler cesty nešlo zavolat bez přetypování.
  input: { url: string; description?: string | undefined; event_types: string[] },
  actorLabel: string,
): Promise<{ endpoint: PublicWebhookEndpoint; secret: string }> {
  assertTargetAllowed(input.url);

  if (input.event_types.length < 1 || input.event_types.length > MAX_EVENT_TYPES_PER_ENDPOINT) {
    throw validationFailed([
      {
        path: 'event_types',
        code: 'out_of_range',
        message: `Endpoint musí odebírat 1 až ${MAX_EVENT_TYPES_PER_ENDPOINT} typů událostí.`,
      },
    ]);
  }

  assertEventTypesKnown(input.event_types, []);

  const existing = await tx
    .select({ id: schema.webhookEndpoints.id })
    .from(schema.webhookEndpoints)
    .where(and(wsEq(ctx, schema.webhookEndpoints), isNull(schema.webhookEndpoints.deletedAt)));
  if (existing.length >= MAX_ENDPOINTS_PER_WORKSPACE) {
    throw new ApiError('conflict', { params: { reason: 'too_many_endpoints' } });
  }

  const secret = generateWebhookSecret();
  const [row] = await tx
    .insert(schema.webhookEndpoints)
    .values({
      workspaceId: ctx.workspaceId,
      url: input.url,
      description: input.description ?? '',
      eventTypes: input.event_types,
      // 4.10.4: kontext webhook_secret brání přesunu hodnoty do jiného sloupce,
      // workspace_id v AAD brání přesunu mezi projekty.
      //
      // encryptEnvelope je SYNCHRONNÍ a vrací objekt, ne řetězec. Obálka
      // enc:v1:<base64> je pole `stored`; ostatní pole (header, aad, ciphertext,
      // tag, envelopeBytes) potřebují jen golden fixtures P02. Kdo sem napíše
      // `await encryptEnvelope({...})` bez `.stored`, uloží do sloupce
      // "[object Object]" a pozná to až při prvním doručení webhooku.
      secretEncrypted: encryptEnvelope({
        plaintext: secret,
        context: 'webhook_secret',
        workspaceId: ctx.workspaceId,
      }).stored,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.created'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: row!.id,
    metadata: { url: input.url, event_types: input.event_types },
  });

  return { endpoint: toPublic(row!), secret };
}

export async function updateEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  input: {
    url?: string | undefined;
    description?: string | undefined;
    event_types?: string[] | undefined;
  },
  actorLabel: string,
): Promise<PublicWebhookEndpoint> {
  const before = await getEndpoint(tx, ctx, id);
  if (input.url !== undefined) assertTargetAllowed(input.url);
  if (
    input.event_types !== undefined &&
    (input.event_types.length < 1 || input.event_types.length > MAX_EVENT_TYPES_PER_ENDPOINT)
  ) {
    throw validationFailed([
      {
        path: 'event_types',
        code: 'out_of_range',
        message: `Endpoint musí odebírat 1 až ${MAX_EVENT_TYPES_PER_ENDPOINT} typů událostí.`,
      },
    ]);
  }
  if (input.event_types !== undefined) {
    assertEventTypesKnown(input.event_types, before.event_types);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.url !== undefined) patch.url = input.url;
  if (input.description !== undefined) patch.description = input.description;
  if (input.event_types !== undefined) patch.eventTypes = input.event_types;

  const [row] = await tx
    .update(schema.webhookEndpoints)
    .set(patch)
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .returning();
  if (!row) throw new ApiError('not_found');

  const after = toPublic(row);
  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.updated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: id,
    metadata: diffForAudit(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    ) as unknown as Record<string, unknown>,
  });
  return after;
}

export async function deleteEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  const deleted = await tx
    .update(schema.webhookEndpoints)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .returning({ id: schema.webhookEndpoints.id });
  if (deleted.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.deleted'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: id,
  });
}

/**
 * Aktivní endpointy projektu, které odebírají daný typ události.
 *
 * PROTI KATALOGU SE TU NEKONTROLUJE NIC a je to schválně, viz
 * `assertEventTypesKnown`. Porovnání řetězců je jediné, co uložený odběr
 * přežije i po přejmenování nebo zrušení typu.
 *
 * ODCHYLKA OD PLÁNU: plán bral `workspaceId: string`. Pravidlo z 3.6 zní, že
 * žádná exportovaná funkce mimo `packages/core/src/tx` workspace jako řetězec
 * nepřijímá, a hlídá to disciplinární test v `identity/scope.test.ts`. Funkce
 * proto bere celý ověřený kontext.
 */
export async function endpointsSubscribedTo(
  tx: Tx,
  ctx: WorkspaceContext,
  eventType: string,
): Promise<Array<{ id: string; url: string; secretEncrypted: string }>> {
  const { rows } = await tx.execute<{ id: string; url: string; secret_encrypted: string }>(sql`
    SELECT id::text AS id, url, secret_encrypted
      FROM webhook_endpoints
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND deleted_at IS NULL
       AND status = 'active'
       AND ${eventType} = ANY(event_types)
  `);
  return rows.map((r) => ({ id: r.id, url: r.url, secretEncrypted: r.secret_encrypted }));
}
