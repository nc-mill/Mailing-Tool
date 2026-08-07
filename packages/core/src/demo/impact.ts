import { sql } from 'drizzle-orm';
import type { Tx } from '../tx';
import type { DemoManifest } from './manifest';

/**
 * CO ÚKLID UDĚLÁ S VĚCMI, KTERÉ DO UKÁZKOVÉ SADY NEPATŘÍ.
 *
 * `purgeDemoData` maže PŘESNĚ řádky z manifestu, takže žádný objekt, který
 * si uživatel založil sám, nezmizí. Tím ale slib „na nic ostatního v projektu
 * se nesáhne" nekončí, protože cizí klíče sahají dál než `DELETE`:
 *
 * - `list_subscriptions.list_id` a `contact_tags.tag_id` mají `ON DELETE cascade`,
 *   takže s ukázkovým seznamem a štítkem mizí i vazby VLASTNÍCH kontaktů. Kontakt
 *   zůstane, ale ztratí přihlášení k seznamu a štítek, a nikdo mu to neřekne.
 * - `campaigns.template_id` a `campaigns.unsubscribe_list_id` mají `ON DELETE set null`,
 *   takže vlastní kampaň postavená na ukázkové šabloně přijde o vazbu na ni.
 *
 * Tahle funkce ta místa spočítá DOPŘEDU, aby okno mohlo říct číslo místo
 * obecné výstrahy. Počítá jen to, co jde spočítat poctivě; segment, který
 * odkazuje na ukázkový seznam v definici, tady schválně není (odkazy jsou
 * v JSONB a `resolveReferences` je čte za běhu, takže by se to muselo číst
 * pokaždé znovu a hrubým skenem).
 */
export type DemoImpact = {
  /**
   * Vlastní kontakty, které se odhlásí z ukázkového seznamu nebo přijdou
   * o ukázkový štítek. Kontakt sám zůstává.
   */
  contacts: number;
  /** Vlastní kampaně, které přijdou o ukázkovou šablonu nebo odhlašovací seznam. */
  campaigns: number;
};

export const NO_DEMO_IMPACT: DemoImpact = { contacts: 0, campaigns: 0 };

export async function readDemoImpact(
  tx: Tx,
  workspaceId: string,
  manifest: DemoManifest,
): Promise<DemoImpact> {
  // sql.param() je u seznamů povinné, viz komentář v purge.ts. Prázdné pole
  // je v pořádku: `= ANY('{}')` je nepravda a `<> ALL('{}')` je pravda,
  // takže sada bez seznamů nebo bez šablon vyjde na nulu, ne na všechno.
  const ids = (list: readonly string[]) => sql.param([...list]);
  const ws = workspaceId;

  const { rows } = await tx.execute<{ contacts: string; campaigns: string }>(sql`
    SELECT
      (SELECT count(*)::text FROM contacts c
        WHERE c.workspace_id = ${ws}
          AND c.deleted_at IS NULL
          AND c.id <> ALL(${ids(manifest.contactIds)})
          AND (EXISTS (SELECT 1 FROM list_subscriptions ls
                        WHERE ls.workspace_id = ${ws} AND ls.contact_id = c.id
                          AND ls.list_id = ANY(${ids(manifest.listIds)}))
            OR EXISTS (SELECT 1 FROM contact_tags ct
                        WHERE ct.workspace_id = ${ws} AND ct.contact_id = c.id
                          AND ct.tag_id = ANY(${ids(manifest.tagIds)})))) AS contacts,
      (SELECT count(*)::text FROM campaigns cp
        WHERE cp.workspace_id = ${ws}
          AND cp.deleted_at IS NULL
          AND cp.id <> ALL(${ids(manifest.campaignIds)})
          AND (cp.template_id = ANY(${ids(manifest.templateIds)})
            OR cp.unsubscribe_list_id = ANY(${ids(manifest.listIds)}))) AS campaigns`);

  const row = rows[0];
  if (row === undefined) return NO_DEMO_IMPACT;
  return { contacts: Number(row.contacts), campaigns: Number(row.campaigns) };
}
