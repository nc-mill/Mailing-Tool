import crypto from 'node:crypto';
import { buildToken } from '@mlain/contracts/token';
import { toContractFields } from './codec';
import type { TrackingKeyring } from './keyring';

const NONCE_BYTES = 8;

/**
 * Vstup vydání identifikačního tokenu.
 *
 * `workspaceId` je tu OBSAH podepisovaného payloadu, ne filtr dotazu: hodnota
 * pochází z ověřeného kliku a putuje do bajtů tokenu i do vstupu MAC. Proto je
 * pojmenovaná v typu, ne v parametru funkce, stejně jako u
 * `IssueUnsubscribeTokenInput` v `packages/core/src/contacts/tokens.ts`.
 */
export type MintIdentityTokenInput = {
  workspaceId: string;
  contactId: string;
  campaignId: string;
  ttlSeconds: number;
  keyring: TrackingKeyring;
  currentKeyId: number;
  now: Date;
};

export type MintedIdentityToken = {
  token: string;
  nonce: Uint8Array;
  /** Unixové sekundy, stejná hodnota jako v payloadu. */
  expiresAt: number;
};

/**
 * Bajty ani MAC se tady neskládají, dělá to `buildToken` z kontraktu.
 * Aplikační je jen nonce z CSPRNG, výpočet expirace a kontrola, že se
 * podepisuje aktuálním pokolením klíče.
 */
export function mintIdentityToken(input: MintIdentityTokenInput): MintedIdentityToken {
  if (!input.keyring.has(input.currentKeyId)) {
    throw new Error(`Aktuální key_id ${input.currentKeyId} není v keyringu`);
  }

  const nonce = new Uint8Array(crypto.randomBytes(NONCE_BYTES));
  const expiresAt = Math.floor(input.now.getTime() / 1000) + input.ttlSeconds;

  const contract = toContractFields({
    type: 'i',
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    campaignId: input.campaignId,
    nonce,
    expiresAt,
  });

  const { token } = buildToken({
    type: contract.type,
    keyId: input.currentKeyId,
    fields: contract.fields,
    keyring: input.keyring,
  });

  return { token, nonce, expiresAt };
}
