/**
 * JEDINÉ místo, kde se píše množinová podmínka „tenhle kontakt v projektu ještě je".
 *
 * PROČ TENHLE SOUBOR VZNIKL: počítadla nad vazebními tabulkami (`list_subscriptions`,
 * `contact_tags`) se ptala jen na vazbu, ne na kontakt. Mazání kontaktu je měkké, vazba
 * po něm zůstává, takže obrazovka seznamů hlásila „50 potvrzených kontaktů" u projektu,
 * ve kterém zbyly tři. Kdo počítá kontakty přes vazbu, musí se zeptat i na kontakt,
 * a ptát se musí přesně stejně jako obálka publika, jinak se počet na obrazovce
 * rozejde s tím, komu se doopravdy odešle.
 *
 * SHODA S OBÁLKOU PUBLIKA. Tři podmínky jsou doslova ty tři, kterými `buildEnvelope`
 * (`segments/compile/envelope.ts`) odděluje vstupní množinu publika od zbytku tabulky.
 * Zbylé dvě podmínky obálky, `processing_restricted` a suppression, se sem VĚDOMĚ
 * nekopírují: to nejsou neexistující lidé, ale existující lidé za branou. Rozpad publika
 * kampaně je proto ukazuje jako vlastní odečtový řádek a členství v seznamu jim trvá.
 * Kdyby je počítadlo seznamu odečítalo, uživatel by nepoznal rozdíl mezi „člověk odešel"
 * a „člověku se nesmí psát", což je právě ten rozdíl, kvůli kterému rozpad existuje.
 *
 * TŘI PODMÍNKY, a žádná z nich není nadbytečná:
 *
 * 1. `deleted_at IS NULL`. Měkké smazání s třicetidenní lhůtou na obnovu. Vazby
 *    schválně přežívají, aby obnovený kontakt dostal zpět svá členství i štítky.
 *
 * 2. `anonymized_at IS NULL`. Výmaz podle článku 17 řádek nemaže, jen ho vyprázdní.
 *    Dnes `contacts/gdpr/erase.ts` nastavuje všechny tři sloupce naráz, takže by
 *    stačila podmínka jedna. Spoléhat na to znamená spoléhat na cizí zápis v místě,
 *    kde se počítají lidé; obálka publika to nedělá a tohle místo taky ne.
 *
 * 3. `status <> 'deleted'`. Druhá cesta k témuž stavu, viz komentář v obálce.
 */

/** Stejný tvar jako `ALIAS_PATTERN` v kompilátoru segmentů: písmeno a nejvýš deset znaků. */
const ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,9}$/;

/** Podmínky obálky, které tenhle predikát přebírá. Test podle nich hlídá úplnost. */
export const EXISTENCE_CONDITIONS = ['deleted_at', 'anonymized_at', 'status_not_deleted'] as const;

/**
 * Vrátí podmínku „kontakt pod tímhle aliasem existuje" bez jediného parametru,
 * takže se dá vložit do dotazu s libovolným číslováním placeholderů.
 *
 * Alias se ověřuje, protože se skládá do SQL textem.
 */
export function contactExistsSql(contactAlias: string): string {
  if (!ALIAS_PATTERN.test(contactAlias)) throw new Error(`invalid alias: ${contactAlias}`);
  const a = contactAlias;
  return `${a}.deleted_at IS NULL AND ${a}.anonymized_at IS NULL AND ${a}.status <> 'deleted'`;
}

/**
 * Tentýž predikát jako `EXISTS` nad tabulkou `contacts` pro řádek vazební tabulky.
 *
 * Vazební tabulky (`list_subscriptions`, `contact_tags`) nesou `workspace_id`, takže
 * se porovnává i on: bez něj by se poddotaz opíral jen o cizí klíč a v multitenantní
 * tabulce by šel obejít. `EXISTS` místo `JOIN` schválně, aby se tvar dotazu volajícího
 * nezměnil a počítadlo zůstalo index only scanem nad vazbou.
 */
export function contactExistsForJoinSql(linkAlias: string, contactAlias = 'ec'): string {
  if (!ALIAS_PATTERN.test(linkAlias)) throw new Error(`invalid alias: ${linkAlias}`);
  if (!ALIAS_PATTERN.test(contactAlias)) throw new Error(`invalid alias: ${contactAlias}`);
  return (
    `EXISTS (SELECT 1 FROM contacts ${contactAlias} ` +
    `WHERE ${contactAlias}.id = ${linkAlias}.contact_id ` +
    `AND ${contactAlias}.workspace_id = ${linkAlias}.workspace_id ` +
    `AND ${contactExistsSql(contactAlias)})`
  );
}
