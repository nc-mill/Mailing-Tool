// packages/db/src/repo/workspaces-global.ts
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { withUser } from './tx';

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
};

/**
 * Výpis projektů aktéra. Běží MIMO workspace kontext, protože kontextů je víc
 * než jeden. Politika ws_member_visibility ho pustí jen k projektům,
 * ve kterých má uživatel členství; bez mlain.user_id vrátí nula řádků.
 */
export async function listWorkspacesForUser(pool: Pool, userId: string): Promise<WorkspaceRow[]> {
  return withUser(pool, userId, async (tx) => {
    const { rows } = await tx.execute<WorkspaceRow>(sql`SELECT id, name, slug, locale, timezone
         FROM workspaces
        WHERE deleted_at IS NULL
        ORDER BY name`);
    return rows;
  });
}

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  locale: string;
  timezone: string;
};

/**
 * Založení projektu. Kontext ještě neexistuje, takže ws_isolation_self by ho
 * zablokovala; pouští ho politika ws_insert_bootstrap.
 *
 * locale a timezone se předávají VŽDY EXPLICITNĚ, i když se rovnají výchozí
 * hodnotě v DDL. Defaulty v DDL jsou pojistka proti NOT NULL při ručním
 * INSERT v migraci, ne konfigurace; zdrojem hodnoty jsou DEFAULT_LOCALE
 * a DEFAULT_TIMEZONE. Bez toho by instalace s DEFAULT_LOCALE=de dostávala
 * u řádků mimo hlavní cestu české hodnoty a projevilo by se to až e-mailem
 * v cizím jazyce.
 */
export async function createWorkspaceAsUser(
  pool: Pool,
  userId: string,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRow> {
  return withUser(pool, userId, async (tx) => {
    // ID se generuje DOPŘEDU a hned se nastaví jako kontext. Bez toho operace
    // neprojde a ověřeno je to spuštěním, ne úvahou:
    //
    //   * `INSERT ... RETURNING` uplatní na nový řádek i politiky pro čtení.
    //     ws_insert_bootstrap je FOR INSERT, takže na RETURNING nedosáhne,
    //     a ws_isolation_self porovnává s kontextem, který by nebyl nastavený.
    //     Naměřeno: tentýž INSERT bez RETURNING projde, s RETURNING skončí
    //     na "new row violates row-level security policy".
    //   * Vložení členství by neprošlo ani tak: ws_isolation na memberships
    //     má WITH CHECK proti workspace kontextu.
    //
    // Past, které se tímhle vyhýbáme, je nejlevnější cesta k zelenému testu:
    // uvolnit politiku na memberships. To je přesně ta chyba, které má celý
    // model bránit, a nikdo by si toho v revizi nevšiml.
    const id = uuidv7();
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${id}, true)`);

    const { rows } = await tx.execute<WorkspaceRow>(
      sql`INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
       VALUES (${id}, ${input.name}, ${input.slug}, ${input.locale}, ${input.timezone}, ${userId})
       RETURNING id, name, slug, locale, timezone`,
    );
    await tx.execute(
      sql`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${id}, ${userId}, 'owner')`,
    );
    // RETURNING pod politikami pro čtení nemusí vrátit nic. Kdyby se to stalo,
    // je to porucha izolace, ne prázdný výsledek, takže se hlásí hlasitě.
    const created = rows[0];
    if (created === undefined) {
      throw new Error('INSERT do workspaces nevrátil řádek; RETURNING neprošlo politikami');
    }
    return created;
  });
}
