/**
 * Spojení pod rolí `mlain_migrator` pro testy. NENÍ součástí produkční cesty
 * a aplikace ho nikdy neimportuje: `mlain_migrator` obchází RLS a smí DDL,
 * takže by jím šlo obejít celý model izolace.
 *
 * Používá se přesně na dvě věci:
 *   1. DDL v testech (`mlain_app` má na schéma public jen USAGE a DML granty),
 *   2. úklid mezi testy (pod `mlain_app` smaže RLS nula řádků BEZ CHYBY).
 */
import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;

function migratorPool(): Pool {
  if (pool) return pool;
  const url = process.env['DATABASE_URL_MIGRATOR'];
  if (!url) {
    // Tvrdě, ne přeskočením. Test, který se tiše přeskočí, je test, který
    // nikdy nic neochránil, a přesně tenhle vzor už jednou nechal celou sadu
    // bran neběžet, aniž by to někdo poznal.
    throw new Error(
      'DATABASE_URL_MIGRATOR není nastavená. Testy, které potřebují DDL nebo úklid, ' +
        'nesmí běžet pod aplikační rolí: DDL by spadlo a DELETE by pod RLS tiše ' +
        'smazal nula řádků.',
    );
  }
  pool = new Pool({ connectionString: url, max: 2, options: '-c timezone=UTC' });
  return pool;
}

export async function asMigrator<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await migratorPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closeMigratorPool(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end();
}
