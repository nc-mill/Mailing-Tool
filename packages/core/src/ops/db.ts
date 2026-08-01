import { createPool, withoutContext, type Tx } from '@mlain/db';
import { assertDumpRoleSeesAllRows } from './backup-guard';

/**
 * Transakce pro provozní čtení a zápis NAPŘÍČ CELOU INSTALACÍ.
 *
 * Používají ji `backup`, `restore`, `verify`, `doctor`, `rotate-credentials`
 * a `upgrade`. Všechny běží pod `DATABASE_URL_MIGRATOR`, protože migrátor
 * vlastní schéma a jen na něj se politiky RLS neuplatní.
 *
 * Kontrola role tu není z opatrnosti, ale proto, že opačný stav NENÍ VIDĚT:
 * pod `mlain_app` bez kontextu vrátí `SELECT DISTINCT fingerprint_key_id
 * FROM suppressions` prázdno, `mlain doctor` z toho usoudí, že instalaci
 * nechybí žádné pokolení klíče, skončí nulou a zapíše do logu, že je vše
 * v pořádku. Ověřeno spuštěním: táž tabulka vrací 2 řádky pod migrátorem
 * a 0 řádků pod aplikační rolí bez kontextu.
 *
 * Funkce pro práci UVNITŘ jednoho projektu tudy NEVEDOU. Ty berou `tx: Tx`
 * a transakci jim otevírá volající přes `withWorkspace`, protože jinak by
 * obcházely izolaci projektů.
 */
export async function withAdminTx<T>(databaseUrl: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await assertDumpRoleSeesAllRows(databaseUrl);
  const pool = createPool(databaseUrl, 'app', 2);
  try {
    return await withoutContext(pool, fn);
  } finally {
    await pool.end();
  }
}
