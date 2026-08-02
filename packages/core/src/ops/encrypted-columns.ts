import { sql } from 'drizzle-orm';
import type { CredentialContext } from '@mlain/contracts/crypto';
import { withAdminTx } from './db';

export type EncryptedColumn = {
  table: string;
  column: string;
  /** Sloupce, které řádek jednoznačně určují. U partitionovaných tabulek jsou dva. */
  primaryKey: readonly string[];
  /**
   * Kontext obálky podle 4.10.4. Dešifrování s jiným kontextem musí selhat.
   * Typ je uzavřený výčet z kontraktu, ne volný řetězec: `CREDENTIAL_CONTEXTS`
   * má čtyři hodnoty a překlep by se jinak projevil až za běhu jako
   * `crypto_context_mismatch` nad daty, která už nejdou dešifrovat.
   */
  context: CredentialContext;
};

/**
 * Úplný seznam sloupců, které nesou šifrovou obálku. Kdo přidá nový, přidá ho
 * i sem, jinak ho `mlain rotate-credentials` přeskočí a po odebrání starého
 * klíče se hodnota už nikdy nedešifruje. Hlídá to test s dotazem do
 * information_schema, ne dobrá vůle.
 *
 * JMÉNA SEDÍ SE SCHÉMATEM P03 a hlídá to test v kroku 1. Dřívější znění mělo
 * tři ze čtyř položek špatně (`sending_providers.credentials_encrypted`
 * místo `config_encrypted` a tabulku `ai_providers` místo
 * `ai_provider_credentials`), což by znamenalo, že hlídač registru najde dva
 * neregistrované sloupce a rotace odmítne běžet úplně.
 */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  {
    table: 'sending_providers',
    column: 'config_encrypted',
    primaryKey: ['id'],
    context: 'sending_provider',
  },
  {
    table: 'webhook_endpoints',
    column: 'secret_encrypted',
    primaryKey: ['id'],
    context: 'webhook_secret',
  },
  {
    table: 'ai_provider_credentials',
    column: 'api_key_encrypted',
    primaryKey: ['id'],
    context: 'ai_provider',
  },
  {
    // `inbound_secret` jako kontext NEEXISTUJE. CREDENTIAL_CONTEXTS má čtyři
    // hodnoty: sending_provider, ai_provider, webhook_secret, oauth_token.
    // Tajemství příchozího endpointu je svým významem tajemství webhooku,
    // takže se používá `webhook_secret`. Kdyby to P07 jako vlastník
    // `inbound_endpoints` šifroval jinak, je to nález proti P07, ne důvod
    // zavádět pátý kontext, který kontrakt nezná.
    table: 'inbound_endpoints',
    column: 'secret_encrypted',
    primaryKey: ['id'],
    context: 'webhook_secret',
  },
];

const ENCRYPTED_SUFFIX = '_encrypted';

export async function discoverEncryptedColumns(adminUrl: string): Promise<string[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ table_name: string; column_name: string }>(
      sql`SELECT table_name, column_name
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND column_name LIKE ${`%${ENCRYPTED_SUFFIX}`}
           ORDER BY table_name, column_name`,
    );
    return rows.map((r) => `${r.table_name}.${r.column_name}`);
  });
}

export async function unregisteredEncryptedColumns(adminUrl: string): Promise<string[]> {
  const registered = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`));
  return (await discoverEncryptedColumns(adminUrl)).filter((c) => !registered.has(c));
}
