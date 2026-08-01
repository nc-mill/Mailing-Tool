/**
 * Konstanty domény kontaktů, které potřebuje rozhraní.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán je importuje z `@mlain/core/contacts`
 * (úkoly 63 a 64). Balíček je ale má jen v `packages/core/src/contacts/constants.ts`
 * a barrel `src/contacts/index.ts` je nereexportuje. Hlubší podcesta nepomůže: mapa
 * `exports` balíčku má zástupný znak `"./*": "./src/*&#47;index.ts"`, takže
 * `@mlain/core/contacts/constants` se rozřeší na adresář, který neexistuje.
 *
 * Hodnoty se proto zrcadlí tady a test `limits.test.ts` je drží shodné s plánem.
 * Jakmile P07 doplní tři řádky do barrelu domény, tenhle soubor se z něj bude jen
 * reexportovat a nic dalšího se měnit nebude.
 */

/** Kolik dní musí uplynout od trvalého nedoručení, než ho jde odblokovat. */
export const HARD_BOUNCE_REMOVAL_MIN_DAYS = 30;

/**
 * Strop ruční práce u kontroly oslovení. Nad kterýkoliv z nich rozhraní nabídne
 * jako doporučenou volbu „u nejistých kontaktů použít neutrální oslovení".
 */
export const VOCATIVE_REVIEW_GROUP_SOFT_LIMIT = 100;
export const VOCATIVE_REVIEW_RATIO_SOFT_LIMIT = 0.1;
