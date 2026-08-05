/**
 * KTERÁ ZNAČKA VYDÁVÁ OSLOVENÍ V 5. PÁDU.
 *
 * Zjištěno z reálného provozu, ne vymyšleno. V ukázkové šabloně měsíčního
 * newsletteru stálo původně jediné `{{ contact.greeting }}`. Uživatel ji otevřel
 * v editoru, napsal literál „Dobrý den," a z nabídky vybral pole s popiskem
 * „Křestní jméno v 5. pádu", tedy `contact.first_name_vocative`. V náhledu pak
 * viděl „Dobrý den, Petr" a měl za to, že nefunguje skloňování.
 *
 * Nefungovala nabídka. `contact.first_name_vocative` je SUROVINA: u kontaktu
 * v jazyce bez vokativu (`en`) obsahuje nominativ, u kontaktu bez jména je prázdný,
 * a literál s čárkou vedle něj pak vyrobí „Dobrý den, " s visící čárkou. Hotovou
 * a vždy gramatickou větu vydává jedině `contact.greeting`, protože ji skládá
 * `buildGreeting` v jádře, které prázdné jméno umí (spadne na neutrální „Dobrý den"
 * BEZ čárky).
 *
 * Tenhle soubor je čistá funkce: rozhoduje jen podle cesty pole, nesahá nikam.
 */

/** Hotová věta i s vokativem. Jediná značka, kterou se má oslovovat. */
export const GREETING_PATH = 'contact.greeting';

/**
 * Suroviny oslovení. Nejsou zakázané, mají legitimní použití (například
 * „Vaše objednávka, {{ contact.first_name_vocative }}"), ale u každé musí být
 * vidět, že sama o sobě větu neutvoří.
 */
const NAME_FRAGMENTS = new Set([
  'contact.first_name',
  'contact.last_name',
  'contact.first_name_vocative',
  'contact.last_name_vocative',
  'contact.title_prefix',
  'contact.title_suffix',
]);

export type GreetingGuidance = 'greeting' | 'nameFragment' | null;

/**
 * `expr` může nést filtry (`contact.first_name | default`), takže se před
 * porovnáním odřízne všechno za svislítkem, stejně jako v `useFieldLabel`.
 */
export function greetingGuidanceFor(expr: string): GreetingGuidance {
  const path = (expr.split('|')[0] ?? '').trim();
  if (path === GREETING_PATH) return 'greeting';
  return NAME_FRAGMENTS.has(path) ? 'nameFragment' : null;
}
