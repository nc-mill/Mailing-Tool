import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Ukládá tenhle projekt IP adresy? Rozhodnutí R8 plánu: je to volba provozovatele
 * a ve výchozím stavu je vypnutá.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ VLASTNICTVÍM SOUBORŮ. Plán čte `storeIpEnabled`
 * z `contacts/settings.ts`. Ten soubor ale vlastní větev `contacts` nastavení projektu
 * a přepínač leží ve větvi `privacy`, kterou vlastní P04. Čtení cizí větve proto žije
 * ve vlastním souboru, aby se nemíchalo se schématem, které tahle doména validuje
 * a vystavuje ven. Volající se nemění: pořád je to jedno `await storeIpEnabled(tx, ctx)`.
 *
 * Chybějící nebo poškozená hodnota znamená `false`. Ukládat IP "pro jistotu" je přesně
 * ta chyba, kterou přepínač řeší.
 */
export async function storeIpEnabled(tx: Tx, ctx: WorkspaceContext): Promise<boolean> {
  const { rows } = await tx.execute<{ store_ip: unknown }>(sql`
    SELECT settings -> 'privacy' ->> 'store_ip' AS store_ip
      FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  return rows[0]?.store_ip === 'true';
}
