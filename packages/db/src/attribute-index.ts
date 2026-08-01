// packages/db/src/attribute-index.ts
import type { Pool } from 'pg';

/**
 * Zakládá a ruší indexy nad vlastními poli v contacts.attributes.
 *
 * Proč to patří sem: DDL smí podle kapitoly 8 jedině tenhle balíček, ale
 * seznam vlastních polí vlastní doména kontaktů. Utilita je ta hranice.
 *
 * CONCURRENTLY je POVINNÉ a nesmí běžet v transakci. Ověřeno spuštěním:
 * uvnitř BEGIN skončí příkaz chybou 25001. Kdyby se index zakládal bez
 * CONCURRENTLY, zamkl by contacts na zápis na celou dobu stavby, tedy
 * u pěti milionů kontaktů na minuty, během kterých by neprošel jediný
 * import ani jediné přihlášení k odběru.
 */

/** Jméno indexu je odvozené, ne předané: volající nesmí určovat identifikátor. */
export function attributeIndexName(key: string): string {
  return `idx_contacts__attr_${key}`;
}

function assertKey(key: string): void {
  // Týž tvar jako ck_contact_fields__key. Klíč jde do identifikátoru
  // i do textového literálu, takže kontrola musí být tady, ne u volajícího.
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    throw new Error(`klíč vlastního pole '${key}' nemá povolený tvar`);
  }
}

/**
 * Založí index nad jedním vlastním polem. Vrací true, když index po doběhnutí
 * existuje a je PLATNÝ.
 *
 * Neplatný index po neúspěchu je ten stav, kvůli kterému má index_state
 * hodnotu 'failed': CREATE INDEX CONCURRENTLY po chybě nechá v katalogu
 * záznam s indisvalid = false, který nikdo nepoužije, ale místo zabírá.
 * Volající ho musí zahodit a stav zapsat, ne to mlčky zkusit znovu.
 */
export async function ensureAttributeIndex(pool: Pool, key: string): Promise<boolean> {
  assertKey(key);
  const name = attributeIndexName(key);
  const client = await pool.connect();
  try {
    // Bez transakce. CONCURRENTLY uvnitř BEGIN skončí chybou 25001.
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ` +
        `ON contacts (workspace_id, (attributes->>'${key}')) ` +
        `WHERE deleted_at IS NULL`,
    );
  } catch (error) {
    await dropAttributeIndex(pool, key); // ať po sobě neuklízí nikdo jiný
    throw error;
  } finally {
    client.release();
  }
  return isAttributeIndexValid(pool, key);
}

/** Ptá se KATALOGU, ne toho, jestli příkaz nevyhodil chybu. */
export async function isAttributeIndexValid(pool: Pool, key: string): Promise<boolean> {
  assertKey(key);
  const { rows } = await pool.query<{ valid: boolean }>(
    `SELECT i.indisvalid AS valid
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1`,
    [attributeIndexName(key)],
  );
  return rows[0]?.valid === true;
}

export async function dropAttributeIndex(pool: Pool, key: string): Promise<void> {
  assertKey(key);
  await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${attributeIndexName(key)}`);
}
