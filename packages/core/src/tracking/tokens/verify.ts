import { TokenError, verifyToken } from '@mlain/contracts/token';
import type { TokenErrorCode, TrackingTokenFields, TrackingTokenType } from '../types';
import { fromContractFields } from './codec';
import type { TrackingKeyring } from './keyring';

export type VerifyOptions = { keyring: TrackingKeyring; now: Date };

export type VerifyResult =
  { ok: true; fields: TrackingTokenFields; keyId: number } | { ok: false; code: TokenErrorCode };

/**
 * Kroky 1 až 8 z kontraktu 4.10.3 části 1 v normativním pořadí **dělá
 * kontraktní `verifyToken`**, včetně kanonického base64url, kontroly délky
 * proti typu, vazby typu na endpoint, ověření MAC v konstantním čase
 * a toho, že se hodnoty z payloadu použijí až po něm.
 *
 * Tenhle obal přidává jen tři aplikační věci:
 * 1. seznam povolených typů místo jednoho, protože povrch `/t/**` mountuje
 *    víc cest do jedné podaplikace,
 * 2. výsledek jako hodnotu místo výjimky, protože pixel na neplatný token
 *    nesmí odpovědět chybou, ale GIFem,
 * 3. překlad na doménové typy.
 *
 * Jednorázovost typu `i` (druhá polovina kroku 8) tady schválně **nic
 * neřeší**: potřebuje databázi a tahle funkce je čistá. Dělá ji
 * `consumeIdentityToken` unikátním klíčem, viz Task 31. Proto se sem předává
 * `isNonceUsed`, které vždy vrací `false`.
 */
export function verifyTrackingToken(
  token: string,
  allowedTypes: readonly TrackingTokenType[],
  options: VerifyOptions,
): VerifyResult {
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  let lastCode: TokenErrorCode = 'token_type_mismatch';

  for (const endpointType of allowedTypes) {
    try {
      const verified = verifyToken({
        token,
        endpointType,
        keyring: options.keyring,
        now: nowSeconds,
        isNonceUsed: () => false,
      });
      return {
        ok: true,
        keyId: verified.keyId,
        fields: fromContractFields(verified.type, verified.fields),
      };
    } catch (error) {
      if (!(error instanceof TokenError)) throw error;
      // Neshoda typu znamená jen "tenhle endpoint ne", zkusí se další povolený.
      // Každá jiná chyba je konečná a další typ by ji nezměnil.
      if (error.code !== 'token_type_mismatch') return { ok: false, code: error.code };
      lastCode = error.code;
    }
  }

  return { ok: false, code: lastCode };
}
