import { validationFailed } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { findTemplateById } from '../../templates/repository';
import { withWorkspace } from '../../tx';

/**
 * KONTROLA ODKAZU NA VEŘEJNOU STRÁNKU.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 4.4 a 5. Formulář i seznam ukládají odkaz na `templates` s
 * `kind = 'page'`; jenže ani jeden z těch odkazů nemá cizí klíč na druh, takže
 * kdyby se nekontrolovalo tady, uložilo by se cokoliv.
 *
 * PROČ SE ODMÍTÁ, A NE MLČKY IGNORUJE. Vykreslit kampaň jako veřejnou stránku
 * by pustilo na naši doménu blok syrového HTML, který profil `page` schválně
 * zakazuje (4.4 plánu). Čtení má sice vlastní pojistku
 * (`contacts/public/page-template.ts` spadne na vestavěný text), ale ta je pro
 * stránku, která se pokazila POTOM. Vědomé uložení cizího druhu musí skončit
 * chybou validace, jinak si autor nastaví e-mail a bude si myslet, že je hotovo.
 *
 * CIZÍ PROJEKT SE POZNÁ SÁM. `findTemplateById` filtruje podle `workspace_id`
 * a běží pod politikou RLS, takže šablona jiného projektu vyjde jako
 * neexistující. Odpověď je proto stejná jako u překlepu v identifikátoru
 * a z chyby nejde zjišťovat, co v cizím projektu existuje.
 */
export async function assertPageTemplateRefs(
  ctx: WorkspaceContext,
  refs: Record<string, string | null | undefined>,
): Promise<void> {
  for (const [field, templateId] of Object.entries(refs)) {
    // `undefined` je „tělo o poli nemluví", `null` je „vestavěný text".
    // Ani jedno se neověřuje, protože se na nic neodkazuje.
    if (templateId === undefined || templateId === null) continue;

    const found = await withWorkspace(ctx, async (tx) => findTemplateById(tx, ctx, templateId));
    if (found === undefined) {
      throw validationFailed([
        {
          path: field,
          code: 'unknown_reference',
          message: 'Stránka, která se má návštěvníkovi ukázat, v projektu neexistuje.',
        },
      ]);
    }
    if (found.kind !== 'page') {
      throw validationFailed([
        {
          path: field,
          code: 'not_a_page_template',
          message:
            'Tohle je e-mail, ne veřejná stránka. Jako stránku pro návštěvníka jde vybrat jen návrh druhu stránka.',
        },
      ]);
    }
  }
}
