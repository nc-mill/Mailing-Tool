import * as schema from '@mlain/db/schema';
import type { Tx } from '../../tx';
import { DEFAULT_CONFIRMATION_MODE } from '../constants';

/**
 * VÝCHOZÍ SEZNAM „ODBĚRATELÉ". Rozhodnutí zadavatele z 5. 8. 2026.
 *
 * Bez něj začíná projekt bez jediného seznamu, a seznam je přitom to, kam
 * kontakt musí patřit, aby mu šlo poslat kampaň. Sloupec `lists.is_default`,
 * `setDefault()` i `getDefault()` existovaly už dřív a NIKDO je nepoužíval:
 * výchozí seznam nikdy nevznikl, takže se `getDefault()` nedalo na co zeptat.
 *
 * PROČ JE TO SAMOSTATNÁ FUNKCE A NE DVA STEJNÉ INSERTY: projekt zakládají DVĚ
 * cesty. `createWorkspace()` je každý další projekt, `runSetup()` je ten úplně
 * první, tedy průvodce prvním spuštěním instalace. Do 7. 8. 2026 měla seznam
 * jen ta první, takže první projekt instalace se choval jinak než každý další
 * a nikdo nevěděl proč. Naměřeno na čisté instalaci: `select * from lists`
 * vrátilo nula řádků, přestože `workspaces` mělo řádek jeden. Následek nebyl
 * kosmetický: import cílový seznam VYŽADUJE, takže úplně první věc, kterou nový
 * uživatel v produktu dělá, narazila na prázdnou nabídku.
 *
 * VOLÁ SE VE STEJNÉ TRANSAKCI JAKO PROJEKT, ne zvlášť. Kontext
 * `mlain.workspace_id` už musí být nastavený, jinak `ws_isolation` zápis
 * do `lists` odmítne. Samostatná transakce potom by znamenala projekt, který
 * při chybě zůstane bez výchozího seznamu, a nikdo by to nedohledal.
 *
 * Jméno se řídí jazykem PROJEKTU, ne jazykem uživatele: seznam vidí celý tým
 * a přejmenovat ho jde na jeho detailu.
 */
export async function insertDefaultList(
  tx: Tx,
  input: { workspaceId: string; locale: string },
): Promise<void> {
  await tx.insert(schema.lists).values({
    workspaceId: input.workspaceId,
    name: defaultListName(input.locale),
    /**
     * `opt_in = 'double'` je bezpečná výchozí volba: seznam je nositelem
     * oprávnění k rozesílce a přepnout ho na jeden krok jde jedním kliknutím.
     */
    optIn: 'double',
    /**
     * Doménová výchozí hodnota, ne ta z DDL. `lists.confirmation_mode` má
     * v DDL `two_step` jako pojistku pro zápis mimo doménu, kdežto seznam
     * založený produktem dostává `one_step` (rozhodnutí R2 plánu). Bez tohohle
     * řádku by se výchozí seznam choval jinak než každý další, který si
     * uživatel založí sám, a nikdo by nevěděl proč.
     */
    confirmationMode: DEFAULT_CONFIRMATION_MODE,
    isDefault: true,
  });
}

/** Název výchozího seznamu podle jazyka projektu. */
export function defaultListName(locale: string): string {
  return locale.toLowerCase().startsWith('cs') ? 'Odběratelé' : 'Subscribers';
}
