import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../errors/api-error';
import type { Permission } from './permissions';

/** RFC 4648 base32 abeceda malými písmeny, bez paddingu. */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Lower(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 3.5: prefix z 5 bajtů má 8 znaků, veřejný prefix z 10 bajtů má 16 znaků. */
export const SECRET_PREFIX_BYTES = 5;
export const PUBLIC_PREFIX_BYTES = 10;
export const SECRET_BYTES = 32;

export const PUBLIC_KEY_SCOPES: readonly Permission[] = ['events:write'];

const SECRET_KEY_PATTERN = /^ml_(live|test)_([a-z2-7]{8})_([A-Za-z0-9_-]{43})$/;
const PUBLIC_KEY_PATTERN = /^ml_pub_([a-z2-7]{16})$/;

export function secretHashOf(secret: string): Buffer {
  // SHA-256 stačí: sekret má 256 bitů entropie z CSPRNG, takže pomalý hash by
  // jen přidal desítky milisekund na každý API request. U hesel je to naopak.
  return createHash('sha256').update(secret, 'ascii').digest();
}

export function generateSecretKey(): { key: string; prefix: string; secret: string } {
  const prefix = base32Lower(randomBytes(SECRET_PREFIX_BYTES));
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { key: `ml_live_${prefix}_${secret}`, prefix, secret };
}

export function generatePublicKey(): { key: string; prefix: string } {
  const prefix = base32Lower(randomBytes(PUBLIC_PREFIX_BYTES));
  return { key: `ml_pub_${prefix}`, prefix };
}

export function parseSecretKey(
  raw: string,
): { env: string; prefix: string; secret: string } | null {
  const match = raw.match(SECRET_KEY_PATTERN);
  if (!match) return null;
  return { env: match[1]!, prefix: match[2]!, secret: match[3]! };
}

export function parsePublicKey(raw: string): { prefix: string } | null {
  const match = raw.match(PUBLIC_KEY_PATTERN);
  if (!match) return null;
  return { prefix: match[1]! };
}

export type ApiKeyRow = {
  id: string;
  workspaceId: string;
  kind: 'secret' | 'public';
  scopes: readonly Permission[];
  secretHash: Buffer | null;
  previousSecretHash: Buffer | null;
  previousExpiresAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  workspaceDeletedAt: Date | null;
};

export type ApiKeyLoader = (prefix: string, kind: 'secret' | 'public') => Promise<ApiKeyRow | null>;

export type VerifiedApiKey = {
  apiKeyId: string;
  workspaceId: string;
  kind: 'secret' | 'public';
  scopes: readonly Permission[];
  /** true, když se klíč ověřil dožívajícím sekretem z grace období. */
  rotated: boolean;
};

/**
 * Dvě konstantní hodnoty pro dummy porovnání. Musí být dvě, protože klíč
 * v grace období se porovnává dvakrát; jedno dummy porovnání proti dvěma
 * reálným je měřitelný rozdíl a prozradilo by, že klíč existuje a rotuje se.
 */
const DUMMY_HASH_A = createHash('sha256').update('mlain/dummy/a', 'ascii').digest();
const DUMMY_HASH_B = createHash('sha256').update('mlain/dummy/b', 'ascii').digest();

type VerifyOptions = { onCompare?: () => void; now?: Date };

function constantTimeEqual(a: Buffer, b: Buffer, opts: VerifyOptions): boolean {
  opts.onCompare?.();
  // timingSafeEqual hodí výjimku při rozdílné délce, proto se délka kontroluje předem.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 3.5. Algoritmus má dvě větve podle tvaru klíče a větev se vybírá z prefixu
 * řetězce, ještě před jakýmkoliv dotazem do databáze. Bez toho by veřejný klíč
 * propadl do větve tajného, zastavil ho regulární výraz a vrátilo by se 401,
 * které neodpovídá kritériu 26.
 */
export async function verifyApiKey(
  raw: string,
  load: ApiKeyLoader,
  options: VerifyOptions = {},
): Promise<VerifiedApiKey> {
  const now = options.now ?? new Date();

  if (raw.startsWith('ml_pub_')) {
    // P1: neshoda tvaru končí 401 bez dotazu do databáze (kritérium 26b).
    const parsed = parsePublicKey(raw);
    if (!parsed) throw new ApiError('unauthenticated');

    // P2
    const row = await load(parsed.prefix, 'public');
    if (!row) throw new ApiError('unauthenticated');

    // P3. Žádné porovnávání hashů ani dummy porovnání: secret_hash je NULL
    // a hodnota klíče je z definice veřejná, takže tu není co chránit.
    assertUsable(row, now);
    return {
      apiKeyId: row.id,
      workspaceId: row.workspaceId,
      kind: 'public',
      scopes: row.scopes,
      rotated: false,
    };
  }

  // S1
  const parsed = parseSecretKey(raw);
  if (!parsed) throw new ApiError('unauthenticated');
  const provided = secretHashOf(parsed.secret);

  // S2
  const row = await load(parsed.prefix, 'secret');
  if (!row) {
    constantTimeEqual(provided, DUMMY_HASH_A, options);
    constantTimeEqual(provided, DUMMY_HASH_B, options);
    throw new ApiError('unauthenticated');
  }

  // S3
  const primaryOk = constantTimeEqual(provided, row.secretHash ?? DUMMY_HASH_A, options);

  // S4: neshoda v S3 ještě není odmítnutí, zkus grace hash z rotace.
  // Druhé porovnání se provede VŽDY, i když previous_secret_hash chybí, jinak by
  // se z počtu porovnání dalo poznat, že se klíč právě rotuje.
  const graceUsable =
    row.previousSecretHash !== null &&
    row.previousExpiresAt !== null &&
    new Date(row.previousExpiresAt).getTime() > now.getTime();
  const secondaryOk = constantTimeEqual(provided, row.previousSecretHash ?? DUMMY_HASH_B, options);
  const rotatedOk = graceUsable && secondaryOk;

  if (!primaryOk && !rotatedOk) throw new ApiError('unauthenticated');

  // S5
  assertUsable(row, now);

  return {
    apiKeyId: row.id,
    workspaceId: row.workspaceId,
    kind: 'secret',
    scopes: row.scopes,
    rotated: !primaryOk && rotatedOk,
  };
}

function assertUsable(row: ApiKeyRow, now: Date): void {
  if (row.revokedAt) throw new ApiError('unauthenticated');
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
    throw new ApiError('unauthenticated');
  }
  if (row.workspaceDeletedAt) throw new ApiError('unauthenticated');
}
