import 'server-only';
// Doména se importuje na úroveň `@mlain/core/<domena>`. Hlubší podcesta se přes
// zástupný znak v mapě `exports` rozřeší na adresář, ne na soubor.
import { getFieldCatalog } from '@mlain/core/contacts';
// ODCHYLKA OD PLÁNU: `@mlain/core/identity` jako veřejná plocha domény dnes
// **neexistuje** (otevřený požadavek P04-R1 z kapitoly 9.2). Mapa `exports`
// balíčku `@mlain/core` má ale klíč `"./identity/*": "./src/identity/*.ts"`,
// takže `@mlain/core/identity/context` je platná adresa a jediná legitimní
// továrna kontextu je odsud dostupná. Až veřejná plocha vznikne, mění se
// jeden řádek v tomhle souboru.
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { withWorkspace } from '@mlain/core/tx';
import * as schema from '@mlain/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { EditorDocument } from '../model/document-types';
import type { FieldCatalog } from '../model/field-catalog';

/**
 * Čtení pro serverovou komponentu. **Jediné místo, kde editor sahá na `@mlain/core`.**
 * Když P07 nebo P08 něco přejmenují, mění se jen tenhle soubor.
 *
 * ODCHYLKA OD PLÁNU, KTEROU SI NIKDO NESMÍ SPLÉST S NÁVRHEM:
 * plán volá `findTemplateById(tx, …)` a `listTemplates(tx, …)` z `@mlain/core/templates`.
 * Ta doména v repozitáři **není** a router šablon taky ne, takže by se soubor
 * nezkompiloval. Dotaz je tu proto napsaný přímo nad tabulkou `templates`,
 * kterou `@mlain/db` má, a je **dočasnou náhradou**: až P08 repository dodá,
 * smaže se tělo obou funkcí a nahradí voláním domény. Nic jiného se měnit nebude,
 * protože tvar návratové hodnoty odpovídá plánu.
 *
 * Co zůstává z plánu beze změny:
 *
 * 1. `createWorkspaceContext` je **jediná legitimní továrna** kontextu projektu
 *    (P04, 3.6). Ověřuje členství, takže nečlen dostane `not_found`, ne `forbidden`,
 *    a nedá se z toho zjistit, které projekty existují. Kontext se nedá složit ručně,
 *    typ je branded.
 * 2. Dotaz běží uvnitř `withWorkspace`, protože jen v otevřené transakci platí
 *    RLS proměnné.
 * 3. Sloupce chodí v camelCase z Drizzle (`designHash` je `Buffer`), ne ve tvaru,
 *    který vydává REST (`design_hash` jako hex). Převod je tady, ne v komponentě.
 */
export async function loadEditorData(input: {
  userId: string;
  workspaceSlug: string;
  templateId: string;
}): Promise<{
  document: EditorDocument;
  designHash: string;
  name: string;
  fieldCatalog: FieldCatalog;
} | null> {
  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: input.userId,
    workspaceRef: input.workspaceSlug,
  });

  // Katalog polí i šablona jdou naráz: nezávisí na sobě a sériově by to byly
  // dva zbytečné okružní časy do databáze.
  const [rows, fieldCatalog] = await Promise.all([
    withWorkspace(ctx, (tx) =>
      tx
        .select({
          design: schema.templates.design,
          designHash: schema.templates.designHash,
          name: schema.templates.name,
        })
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.workspaceId, ctx.workspaceId),
            eq(schema.templates.id, input.templateId),
            isNull(schema.templates.deletedAt),
          ),
        )
        .limit(1),
    ),
    getFieldCatalog(ctx),
  ]);

  const row = rows[0];
  if (!row) return null;
  return {
    document: row.design as EditorDocument,
    designHash: Buffer.from(row.designHash).toString('hex'),
    name: row.name,
    fieldCatalog,
  };
}

/** Seznam šablon pro rozhodnutí R16. Stránkování MVP 0 nepotřebuje, strop je 50. */
export async function loadTemplateList(input: {
  userId: string;
  workspaceSlug: string;
}): Promise<Array<{ id: string; name: string }>> {
  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: input.userId,
    workspaceRef: input.workspaceSlug,
  });
  return withWorkspace(ctx, (tx) =>
    tx
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(
        and(eq(schema.templates.workspaceId, ctx.workspaceId), isNull(schema.templates.deletedAt)),
      )
      .orderBy(desc(schema.templates.updatedAt))
      .limit(50),
  );
}
