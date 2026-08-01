import { createPool, withoutContext } from '@mlain/db';
import { sql } from 'drizzle-orm';

export class DumpRoleBlindError extends Error {
  constructor(role: string, tables: readonly string[]) {
    super(
      `Záloha se nespustí. Role ${role} podléhá row level security, takže by pg_dump ` +
        `skončil chybou "query would be affected by row-level security policy" u těchhle ` +
        `tabulek: ${tables.join(', ')}. ` +
        `Nastavte DATABASE_URL_MIGRATOR na roli, která vlastní schéma (mlain_migrator). ` +
        `NEPŘIDÁVEJTE pg_dump přepínač --enable-row-security: ten chybu odstraní tím, ` +
        `že vyrobí zálohu, ve které jsou chráněné tabulky prázdné, a prázdná záloha ` +
        `je horší než žádná, protože vypadá jako hotová práce.`,
    );
    this.name = 'DumpRoleBlindError';
  }
}

/**
 * Zjistí, jestli role, pod kterou by běžel pg_dump, uvidí i řádky chráněné RLS.
 * Nezkoumá se počet řádků (ten může být legitimně nula), ale způsobilost:
 * role musí mít BYPASSRLS, být superuživatel, nebo být vlastníkem tabulky,
 * na které není zapnuté FORCE ROW LEVEL SECURITY.
 *
 * `relkind IN ('r','p')` je podstatné. U partitionované tabulky sedí politika
 * na RODIČI, který má relkind 'p'; jednotlivé oddíly mají relkind 'r', ale
 * `relrowsecurity = false`, protože politiku dědí až za běhu dotazu. Dotaz
 * zúžený na 'r' by tedy prověřil 63 běžných tabulek a ANI JEDNU z devíti
 * největších. Ověřeno spuštěním nad schématem s jednou běžnou a jednou
 * partitionovanou tabulkou.
 */
export async function assertDumpRoleSeesAllRows(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 'app', 1);
  try {
    await withoutContext(pool, async (tx) => {
      const { rows: who } = await tx.execute<{
        role: string;
        bypass: boolean;
        superuser: boolean;
      }>(sql`SELECT current_user AS role, rolbypassrls AS bypass, rolsuper AS superuser
               FROM pg_roles WHERE rolname = current_user`);
      if (who[0]!.bypass || who[0]!.superuser) return;

      const { rows: blind } = await tx.execute<{ relname: string }>(
        sql`SELECT c.relname
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND c.relrowsecurity
               AND (c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> current_user)
             ORDER BY c.relname`,
      );
      if (blind.length > 0) {
        throw new DumpRoleBlindError(
          who[0]!.role,
          blind.map((r) => r.relname),
        );
      }
    });
  } finally {
    await pool.end();
  }
}
