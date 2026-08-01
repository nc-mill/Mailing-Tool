import { decryptEnvelope, encryptEnvelope } from '@mlain/contracts/crypto';
import { providerConfigSchema } from './config-schema';
import type { ProviderConfig } from './types';

/**
 * Jediny adapter na kontrakt 4. Kdyby se export z packages/contracts jmenoval jinak,
 * je to oprava na jednom miste, ne v patnacti.
 *
 * Kontext sending_provider a workspace_id v AAD brani dvema realnym utokum: presunu
 * zasifrovane hodnoty z jineho sloupce a presunu SES pristupu projektu A do radku
 * provideru projektu B.
 *
 * DVĚ ODCHYLKY OD PLÁNU, obě vynucené skutečným kontraktem.
 *
 * 1. Plán volal `encryptCredential(value, opts)` a `decryptCredential(stored, opts)`.
 *    Kontrakt 4 takové jméno nemá; rozhodnutí R6 uzavřelo, že platí jméno a signatura
 *    vlastníka, tedy P02: `encryptEnvelope({...})` a `decryptEnvelope({...})`
 *    s pojmenovanými argumenty. Obálka vrací objekt, použitelná hodnota je `stored`.
 * 2. Kontrakt šifruje ŘETĚZEC, ne `unknown`. Serializace je proto tady a je to jediné
 *    místo, kde se dělá; kdyby ji dělal každý volající, stačilo by jedno `JSON.stringify`
 *    navíc a dešifrování by vrátilo řetězec v řetězci.
 *
 * Vstupy jsou pojmenované objekty, ne poziční hodnoty: `scope.test.ts` zakazuje
 * exportovanou funkci s parametrem `workspaceId: string` mimo `packages/core/src/tx`
 * a vzor výjimky je `IssueUnsubscribeTokenInput`.
 */
const CONTEXT = 'sending_provider' as const;

export type EncryptProviderConfigInput = { config: ProviderConfig; workspaceId: string };
export type DecryptProviderConfigInput = { stored: string; workspaceId: string };

export function encryptProviderConfig(input: EncryptProviderConfigInput): string {
  return encryptEnvelope({
    plaintext: JSON.stringify(providerConfigSchema.parse(input.config)),
    context: CONTEXT,
    workspaceId: input.workspaceId,
  }).stored;
}

export function decryptProviderConfig(input: DecryptProviderConfigInput): ProviderConfig {
  const plaintext = decryptEnvelope({
    stored: input.stored,
    context: CONTEXT,
    workspaceId: input.workspaceId,
  });
  return providerConfigSchema.parse(JSON.parse(plaintext));
}

/** Pro migracni skript pri rotaci SECRET_KEY, viz cast 4a, 6.3. */
export function reencryptProviderCredentials(input: DecryptProviderConfigInput): string {
  return encryptProviderConfig({
    config: decryptProviderConfig(input),
    workspaceId: input.workspaceId,
  });
}
