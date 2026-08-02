import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DELEGATION_TTL_DAYS } from '../campaigns/constants';

/**
 * "Pošlu to člověku, který spravuje náš web" je hlavní odpověď na otázku, jestli
 * nastavení DNS zvládne netechnický člověk. Nezvládne, ale zvládne vybrat tuhle
 * možnost a přeposlat e-mail.
 *
 * Odkaz ukazuje JEN záznamy pro jednu doménu, návod a stav ověření. Nic z nástroje:
 * žádné kontakty, žádné kampaně, žádný název projektu kromě jména firmy.
 */
export const DELEGATION_PUBLIC_FIELDS = [
  'domain',
  'company_name',
  'records',
  'checks',
  'checked_at',
] as const;

export function createDelegationToken(opts: { now?: Date } = {}): {
  token: string;
  hash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString('base64url');
  const now = opts.now ?? new Date();
  return {
    token,
    hash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now.getTime() + DELEGATION_TTL_DAYS * 86_400_000),
  };
}

export function verifyDelegationToken(
  token: string,
  stored: { hash: string; expiresAt: Date; now?: Date },
): boolean {
  const now = stored.now ?? new Date();
  if (now >= stored.expiresAt) return false;
  const a = Buffer.from(createHash('sha256').update(token).digest('hex'));
  const b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
