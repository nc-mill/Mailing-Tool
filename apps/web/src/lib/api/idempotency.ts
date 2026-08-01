import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { ApiError, validationFailed } from '@mlain/core/errors/api-error';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;

/** 4.4: uložená odpověď nejvýš 64 kB. Větší se neukládá. */
export const MAX_STORED_RESPONSE_BYTES = 64 * 1024;
/** 4.4: souběžný request se stejným klíčem se považuje za opuštěný po 60 s. */
export const LOCK_TAKEOVER_SECONDS = 60;
/** 4.4: retence 24 hodin, úklid jobem platform.cleanup_idempotency. */
export const IDEMPOTENCY_TTL_HOURS = 24;

export function validateIdempotencyKey(raw: string | undefined | null): string {
  if (!raw || !KEY_PATTERN.test(raw)) {
    throw validationFailed([
      {
        path: 'Idempotency-Key',
        code: 'invalid_idempotency_key',
        message: 'Hlavička Idempotency-Key musí mít 8 až 255 znaků z [A-Za-z0-9._:-].',
      },
    ]);
  }
  return raw;
}

/**
 * Kanonický JSON: klíče objektů seřazené podle kódových bodů, bez nevýznamných
 * mezer, čísla v nejkratší podobě. Bez toho by přeformátovaný stejný request
 * vypadal jako jiný a idempotence by nefungovala.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function fingerprintOf(method: string, path: string, body: unknown): Buffer {
  return createHash('sha256')
    .update(`${method}\n${path}\n${canonicalJson(body)}`, 'utf8')
    .digest();
}

export type IdempotencyOutcome<T> =
  { replay: true; status: number; body: unknown } | { replay: false; result: T };

/**
 * Algoritmus ze 4.4. Celý běží uvnitř jedné transakce s nastaveným workspace
 * kontextem, protože idempotency_keys má workspace_id NOT NULL a RLS na něj platí.
 */
export async function withIdempotency<T>(
  tx: Tx,
  input: { workspaceId: string; key: string; method: string; path: string; body: unknown },
  operation: () => Promise<{ status: number; body: unknown; result: T }>,
): Promise<IdempotencyOutcome<T>> {
  const fingerprint = fingerprintOf(input.method, input.path, input.body);
  const scope = and(
    eq(schema.idempotencyKeys.workspaceId, input.workspaceId),
    eq(schema.idempotencyKeys.key, input.key),
  );

  const inserted = await tx
    .insert(schema.idempotencyKeys)
    .values({
      workspaceId: input.workspaceId,
      key: input.key,
      fingerprint,
      status: 'in_progress',
      // `sql.raw` kvůli tomu, že interval nejde parametrizovat jako celek.
      // Hodnota je konstanta modulu, ne vstup z requestu.
      expiresAt: sql`now() + interval '${sql.raw(String(IDEMPOTENCY_TTL_HOURS))} hours'`,
    })
    .onConflictDoNothing()
    .returning({ key: schema.idempotencyKeys.key });

  if (inserted.length === 0) {
    const [row] = await tx.select().from(schema.idempotencyKeys).where(scope).limit(1);
    if (!row) throw new ApiError('conflict');

    if (row.status === 'completed') {
      if (!Buffer.from(row.fingerprint).equals(fingerprint)) {
        throw new ApiError('idempotency_key_reuse');
      }
      return { replay: true, status: row.responseStatus ?? 200, body: row.responseBody };
    }

    // status = in_progress
    const ageSeconds = (Date.now() - new Date(row.lockedAt).getTime()) / 1000;
    if (ageSeconds < LOCK_TAKEOVER_SECONDS) {
      throw new ApiError('idempotency_request_in_progress', { retryAfter: 2 });
    }
    const takeover = await tx
      .update(schema.idempotencyKeys)
      .set({ lockedAt: new Date(), fingerprint })
      .where(and(scope, eq(schema.idempotencyKeys.lockedAt, row.lockedAt)))
      .returning({ key: schema.idempotencyKeys.key });
    if (takeover.length !== 1) {
      throw new ApiError('idempotency_request_in_progress', { retryAfter: 2 });
    }
  }

  try {
    const outcome = await operation();
    const serialized = JSON.stringify(outcome.body ?? null);
    const storable = Buffer.byteLength(serialized, 'utf8') <= MAX_STORED_RESPONSE_BYTES;
    await tx
      .update(schema.idempotencyKeys)
      .set({
        status: 'completed',
        responseStatus: outcome.status,
        responseBody: storable ? (outcome.body as never) : null,
        completedAt: new Date(),
      })
      .where(scope);
    return { replay: false, result: outcome.result };
  } catch (err) {
    // 4.4: chyby 4xx způsobené vstupem se ukládají jako výsledek, protože
    // zopakování stejného špatného requestu má dát stejnou odpověď. Ostatní
    // chyby záznam mažou, aby šel request bezpečně zopakovat.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    await tx.delete(schema.idempotencyKeys).where(scope);
    throw err;
  }
}
