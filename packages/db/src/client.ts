// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index';

export type PoolKind = 'app' | 'readOnly';

/**
 * Časová zóna se vynucuje NA KAŽDÉM SPOJENÍ, ne jen na databázi.
 * ALTER DATABASE smí vlastník databáze nebo superuživatel, a mlain_migrator
 * je ani jeden, takže u externí databáze, kterou nespravujeme, je tohle
 * jediná spolehlivá cesta.
 */
const BASE: PoolConfig = { options: '-c timezone=UTC' };

export function createPool(url: string, kind: PoolKind = 'app', max = 10): Pool {
  return new Pool({
    ...BASE,
    connectionString: url,
    max,
    // Náhled segmentu spouští dynamicky sestavené SQL. Chyba v kompilátoru
    // nesmí mít možnost zapsat, proto je celý pool read-only.
    options:
      kind === 'readOnly' ? '-c timezone=UTC -c default_transaction_read_only=on' : BASE.options,
  });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDb>;

/**
 * Ověří, že aplikace neběží pod rolí, na kterou se izolace nevztahuje.
 *
 * Celý model izolace mlčky předpokládá, že `mlain_app` schéma nevlastní a nemá
 * BYPASSRLS. U samohostitele s managed PostgreSQL, kde je k dispozici jediná
 * role (typicky vlastník databáze nebo rovnou superuživatel), ten předpoklad
 * neplatí a **aplikace se rozeběhne úplně normálně, jen bez izolace projektů**.
 * Nic nespadne, žádný test to nezachytí a zákazník se to nedozví.
 *
 * Volá se při startu aplikace (P04) a z `mlain doctor` (P16). Vrací seznam
 * důvodů; prázdný seznam znamená, že je konfigurace v pořádku.
 */
export async function checkIsolationPrerequisites(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    owns_schema: boolean;
  }>(`SELECT r.rolname, r.rolsuper, r.rolbypassrls,
             (n.nspowner = r.oid) AS owns_schema
        FROM pg_roles r
        JOIN pg_namespace n ON n.nspname = 'public'
       WHERE r.rolname = current_user`);

  const row = rows[0];
  const reasons: string[] = [];
  if (!row) return ['roli aktuálního spojení se nepodařilo zjistit'];
  if (row.rolsuper) {
    reasons.push(
      `role ${row.rolname} je superuživatel, row-level security se na ni ` +
        'nevztahuje a projekty nejsou izolované',
    );
  }
  if (row.rolbypassrls) {
    reasons.push(`role ${row.rolname} má atribut BYPASSRLS, projekty nejsou izolované`);
  }
  if (row.owns_schema) {
    reasons.push(
      `role ${row.rolname} vlastní schéma public, takže se na ni politiky ` +
        'RLS neuplatní; aplikace musí běžet pod mlain_app, ne pod migrátorem',
    );
  }
  return reasons;
}
