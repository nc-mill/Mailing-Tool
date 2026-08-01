import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../tx';
import { ApiError, validationFailed } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import {
  generatePublicKey,
  generateSecretKey,
  secretHashOf,
  PUBLIC_KEY_SCOPES,
  type ApiKeyRow,
} from './api-key';
import { isPermission, type Permission } from './permissions';
import { IdentityAuditActions } from './audit';
import { wsEq } from './scope';
import type { WorkspaceContext } from './types';

/** 3.5: grace období 0 až 86400 sekund, výchozí 0 (starý sekret hned neplatí). */
export const MAX_GRACE_SECONDS = 86_400;
/** 7: zápis last_used_at nejvýš jednou za 60 sekund a mimo hlavní transakci. */
export const LAST_USED_THROTTLE_SECONDS = 60;

export type PublicApiKey = {
  id: string;
  name: string;
  kind: 'secret' | 'public';
  prefix: string;
  scopes: Permission[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function toPublicApiKey(row: {
  id: string;
  name: string;
  kind: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as 'secret' | 'public',
    prefix: row.prefix,
    scopes: row.scopes as Permission[],
    last_used_at: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    expires_at: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    revoked_at: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

function assertScopes(scopes: string[], kind: 'secret' | 'public'): Permission[] {
  if (kind === 'public') {
    // 3.5: veřejný klíč má pevně scope events:write a nic jiného mu nejde přidat.
    if (scopes.length > 0 && (scopes.length !== 1 || scopes[0] !== 'events:write')) {
      throw validationFailed([
        {
          path: 'scopes',
          code: 'public_key_scopes_fixed',
          message: 'Veřejný klíč má pevně scope events:write.',
        },
      ]);
    }
    return [...PUBLIC_KEY_SCOPES];
  }
  const invalid = scopes.filter((s) => !isPermission(s));
  if (invalid.length > 0) {
    throw validationFailed(
      invalid.map((s) => ({
        path: 'scopes',
        code: 'unknown_scope',
        // Wildcard nepovolujeme: klíč s * je klíč, o kterém nikdo neví, co smí.
        message: `Neznámý scope "${s}".`,
      })),
    );
  }
  if (scopes.length === 0) {
    throw validationFailed([
      { path: 'scopes', code: 'scopes_required', message: 'Klíč musí mít aspoň jeden scope.' },
    ]);
  }
  return scopes as Permission[];
}

export async function createApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { name: string; kind: 'secret' | 'public'; scopes: string[]; expires_at: string | null },
  actorLabel: string,
): Promise<{ key: PublicApiKey; secret: string }> {
  const scopes = assertScopes(input.scopes, input.kind);
  // ODCHYLKA OD PLÁNU (jen typová, chování je stejné): plán psal
  // `'secret' in generated ? generated.secret : ''`. Zúžení operátorem `in`
  // nad sjednocením, kde jeden člen tu vlastnost nemá, dá `unknown`, takže by
  // to neprošlo překladem. Větev podle druhu klíče je navíc čitelnější.
  let generated: { key: string; prefix: string };
  let secret = '';
  if (input.kind === 'public') {
    generated = generatePublicKey();
  } else {
    const created = generateSecretKey();
    generated = created;
    secret = created.secret;
  }

  const [row] = await tx
    .insert(schema.apiKeys)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      kind: input.kind,
      prefix: generated.prefix,
      secretHash: input.kind === 'secret' ? secretHashOf(secret) : null,
      scopes,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.created'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: row!.id,
    metadata: { name: input.name, kind: input.kind, scopes },
  });

  return { key: toPublicApiKey(row!), secret: generated.key };
}

export async function listApiKeys(tx: Tx, ctx: WorkspaceContext): Promise<PublicApiKey[]> {
  const rows = await tx
    .select()
    .from(schema.apiKeys)
    .where(and(wsEq(ctx, schema.apiKeys), isNull(schema.apiKeys.revokedAt)))
    .orderBy(desc(schema.apiKeys.createdAt));
  return rows.map(toPublicApiKey);
}

export async function rotateApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { id: string; graceSeconds: number },
  actorLabel: string,
): Promise<{ key: PublicApiKey; secret: string }> {
  if (input.graceSeconds < 0 || input.graceSeconds > MAX_GRACE_SECONDS) {
    throw validationFailed([
      {
        path: 'grace_seconds',
        code: 'out_of_range',
        message: `Hodnota musí být od 0 do ${MAX_GRACE_SECONDS}.`,
      },
    ]);
  }

  const [existing] = await tx
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        wsEq(ctx, schema.apiKeys),
        eq(schema.apiKeys.id, input.id),
        isNull(schema.apiKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new ApiError('not_found');
  if (existing.kind === 'public') {
    throw new ApiError('conflict', { params: { reason: 'public_key_has_no_secret' } });
  }

  /**
   * ODCHYLKA OD PLÁNU, a je to oprava chyby, ne kosmetika. Plán při rotaci
   * měnil i `prefix`. Tím ale grace období PŘESTÁVÁ FUNGOVAT: ověření dělá
   * podle 3.5 jediný lookup podle prefixu a dožívající sekret nese prefix
   * STARÝ, takže by se řádek vůbec nenašel a klient by dostal 401 „klíč
   * neexistuje". Sloupce `previous_secret_hash` a `previous_expires_at` by
   * zůstaly mrtvé, tedy přesně to, před čím plán o dva řádky níž varuje.
   * Naměřeno spuštěním: s přepsaným prefixem vrací starý sekret 401 i uvnitř
   * grace období.
   *
   * Rotace proto mění POUZE sekret. Prefix není tajemství, je to identifikátor
   * klíče, a jeho stabilita navíc drží řádek v UI vizuálně týž.
   */
  const generated = generateSecretKey();
  const rotatedKey = `ml_live_${existing.prefix}_${generated.secret}`;
  const [row] = await tx
    .update(schema.apiKeys)
    .set({
      secretHash: secretHashOf(generated.secret),
      // Sloupce grace období čte krok S4 ověřovacího algoritmu. Bez něj by to
      // byly mrtvé sloupce a grace období jen slib v UI.
      previousSecretHash: input.graceSeconds > 0 ? existing.secretHash : null,
      previousExpiresAt:
        input.graceSeconds > 0
          ? sql`now() + interval '${sql.raw(String(input.graceSeconds))} seconds'`
          : null,
      updatedAt: new Date(),
    })
    .where(and(wsEq(ctx, schema.apiKeys), eq(schema.apiKeys.id, input.id)))
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.rotated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: input.id,
    metadata: { grace_seconds: input.graceSeconds },
  });

  return { key: toPublicApiKey(row!), secret: rotatedKey };
}

export async function revokeApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  // Revokovaný klíč se nemaže, aby audit dával smysl (3.5).
  const revoked = await tx
    .update(schema.apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(wsEq(ctx, schema.apiKeys), eq(schema.apiKeys.id, id), isNull(schema.apiKeys.revokedAt)),
    )
    .returning({ id: schema.apiKeys.id });
  if (revoked.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.revoked'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: id,
  });
}

/** Načtení řádku pro ověření. Běží mimo workspace kontext, protože ten se z klíče teprve zjišťuje. */
export async function loadApiKeyRow(
  tx: Tx,
  prefix: string,
  kind: 'secret' | 'public',
): Promise<ApiKeyRow | null> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT k.id::text          AS id,
           k.workspace_id::text AS workspace_id,
           k.kind               AS kind,
           k.scopes             AS scopes,
           k.secret_hash        AS secret_hash,
           k.previous_secret_hash AS previous_secret_hash,
           k.previous_expires_at  AS previous_expires_at,
           k.revoked_at         AS revoked_at,
           k.expires_at         AS expires_at,
           w.deleted_at         AS workspace_deleted_at
      FROM api_keys k
      JOIN workspaces w ON w.id = k.workspace_id
     WHERE k.prefix = ${prefix} AND k.kind = ${kind}
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    kind: row['kind'] as 'secret' | 'public',
    scopes: row['scopes'] as Permission[],
    secretHash: row['secret_hash'] ? Buffer.from(row['secret_hash'] as Buffer) : null,
    previousSecretHash: row['previous_secret_hash']
      ? Buffer.from(row['previous_secret_hash'] as Buffer)
      : null,
    previousExpiresAt: toDate(row['previous_expires_at']),
    revokedAt: toDate(row['revoked_at']),
    expiresAt: toDate(row['expires_at']),
    workspaceDeletedAt: toDate(row['workspace_deleted_at']),
  };
}

/**
 * Ovladač `node-postgres` vrací `timestamptz` ze `tx.execute()` jako ŘETĚZEC,
 * ne jako `Date` (ověřeno spuštěním, viz komentář v `pagination-integrity.test.ts`).
 * Bez téhle normalizace by porovnání grace období pracovalo s řetězcem.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/** Zápis nejvýš jednou za minutu, mimo hlavní transakci, fire and forget. */
export async function touchApiKeyLastUsed(tx: Tx, apiKeyId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE api_keys SET last_used_at = now()
     WHERE id = ${apiKeyId}::uuid
       AND (last_used_at IS NULL
            OR last_used_at < now() - interval '${sql.raw(String(LAST_USED_THROTTLE_SECONDS))} seconds')
  `);
}
