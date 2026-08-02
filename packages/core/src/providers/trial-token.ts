import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  KEY_PURPOSES,
  currentKeyId,
  deriveKey,
  keyringFromEnv,
  type Keyring,
} from '@mlain/contracts/keyring';
import { TRIAL_VERIFY_TTL_DAYS } from '../campaigns/constants';
import { compactWorkspaceId, expandWorkspaceId } from '../contacts/public/ids';

/**
 * Potvrzovací odkaz na ověřovanou adresu zkušebního režimu.
 *
 * BEZSTAVOVÝ SCHVÁLNĚ, a je to důsledek rozhodnutí D15: zkušební režim nemá
 * vlastní tabulku, žije v `workspaces.settings.campaigns`. Kam tedy uložit stav
 * odkazu? Nikam. Token nese projekt i adresu v sobě a pravost dokládá podpisem,
 * takže se nic ukládat nemusí. Stejný postup jako u nonce formuláře v P07.
 *
 * Odkaz otevírá člověk, který v nástroji NEMÁ účet: je to majitel schránky, který
 * má doložit, že adresa je jeho. Proto token nese `workspace_id` (tentýž důvod,
 * jaký popisuje `contacts/public/ids.ts`) a proto se ověřuje bez přihlášení.
 *
 * Purpose je `mailer/v1/confirm-token` z kontraktu P02. Byl rezervovaný a nepoužitý;
 * tohle je první potvrzovací odkaz, který je opravdu podepsaný, ne náhodných 32 bajtů
 * se stavem v databázi (jak to má double opt-in podle rozhodnutí R4).
 */
const TTL_MS = TRIAL_VERIFY_TTL_DAYS * 86_400_000;

/** Verze je v tokenu proto, aby šel formát vyměnit, aniž by staré odkazy tiše prošly. */
const VERSION = 'v1';

function macFor(master: Uint8Array, payload: string): string {
  return createHmac('sha256', deriveKey(master, KEY_PURPOSES.confirmToken))
    .update(payload, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

function payloadOf(workspaceId: string, email: string, issuedAt: number): string {
  return `${VERSION}.${compactWorkspaceId(workspaceId)}.${email.toLowerCase()}.${issuedAt}`;
}

export type TrialVerificationInput = { workspaceId: string; email: string; now?: Date };

/**
 * Vydá token. `workspaceId` je tu OBSAH zapisovaný do odkazu, ne kontext, pod kterým
 * se sahá na data; tentýž rozdíl popisuje `PublicRefInput` v doméně kontaktů.
 */
export function issueTrialVerificationToken(
  keyring: Keyring,
  input: TrialVerificationInput,
): string {
  const issuedAt = (input.now ?? new Date()).getTime();
  const master = keyring.get(currentKeyId(keyring));
  if (master === undefined) throw new Error('keyring nezná aktuální pokolení');
  const email = input.email.toLowerCase();
  const payload = payloadOf(input.workspaceId, email, issuedAt);
  const encodedEmail = Buffer.from(email, 'utf8').toString('base64url');
  return [
    VERSION,
    compactWorkspaceId(input.workspaceId),
    encodedEmail,
    String(issuedAt),
    macFor(master, payload),
  ].join('.');
}

export type TrialVerification =
  | { ok: true; workspaceId: string; email: string; issuedAt: number }
  | { ok: false; reason: 'malformed' | 'expired' | 'invalid' };

/** Ověření přes VŠECHNA pokolení klíče: rotace nesmí zneplatnit rozeslané odkazy. */
export function verifyTrialVerificationToken(
  keyring: Keyring,
  token: string,
  options: { now?: Date } = {},
): TrialVerification {
  const parts = token.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [version, compact, encodedEmail, rawIssuedAt, provided] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) return { ok: false, reason: 'malformed' };
  if (!/^[0-9a-f]{32}$/.test(compact)) return { ok: false, reason: 'malformed' };

  const issuedAt = Number(rawIssuedAt);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed' };

  let email: string;
  try {
    email = Buffer.from(encodedEmail, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (email.length === 0) return { ok: false, reason: 'malformed' };

  const now = (options.now ?? new Date()).getTime();
  if (now - issuedAt > TTL_MS) return { ok: false, reason: 'expired' };

  const workspaceId = expandWorkspaceId(compact);
  const payload = payloadOf(workspaceId, email, issuedAt);
  const providedBytes = Buffer.from(provided, 'utf8');
  for (const master of keyring.values()) {
    const expected = Buffer.from(macFor(master, payload), 'utf8');
    // Porovnání v konstantním čase, jako u každého tajemství v produktu.
    if (expected.length === providedBytes.length && timingSafeEqual(expected, providedBytes)) {
      return { ok: true, workspaceId, email, issuedAt };
    }
  }
  return { ok: false, reason: 'invalid' };
}

/**
 * Varianty s keyringem z prostředí. Používá je vrstva API a veřejná stránka
 * potvrzení; klíče vlastní doména, ne stránka (týž důvod jako u `issueFormNonce`).
 */
export function issueTrialToken(input: TrialVerificationInput): string {
  return issueTrialVerificationToken(keyringFromEnv(), input);
}

export function verifyTrialToken(token: string, options: { now?: Date } = {}): TrialVerification {
  return verifyTrialVerificationToken(keyringFromEnv(), token, options);
}
