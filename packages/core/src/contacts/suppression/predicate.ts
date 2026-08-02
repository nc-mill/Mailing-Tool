/**
 * JEDINÉ místo, kde se píše množinová podmínka „tenhle kontakt je zablokovaný".
 *
 * Řádkovou kontrolu vlastní `contacts/repo/suppressions.ts` a ta se z principu
 * nedá použít nad publikem o statisících řádcích: bylo by to statisíce kol do
 * databáze místo jednoho množinového dotazu. Podmínka proto musí existovat
 * i jako kus SQL, který jde vložit do cizího dotazu.
 *
 * PROČ TENHLE SOUBOR VZNIKL: tatáž podmínka byla opsaná na čtyřech místech
 * (materializace publika, obálka segmentu, rozpad publika po branách a operátor
 * `is_suppressed`). Čtyři kopie téhož predikátu znamenají, že vynechání jedné
 * podmínky v jedné z nich se navenek neprojeví hned, jen se někomu odešle pošta.
 * Kopie tady končí a hlídá to `contacts/test/repo/suppressions.query-shape.test.ts`.
 *
 * TŘI POVINNÉ PODMÍNKY, stejné jako u řádkové kontroly:
 *
 * 1. `removed_at IS NULL`. Odblokovaný řádek v tabulce zůstává, jen měkce
 *    odebraný. Bez téhle podmínky by odblokování bylo tiše bez efektu.
 *
 * 2. Větev přes otisk. Po výmazu podle článku 17 plaintextovou adresu neznáme,
 *    takže porovnání podle `email` na takového člověka nedosáhne a šel by
 *    znovu naimportovat i zpracovat.
 *
 * 3. Porovnání proti POLI `email_fingerprints`, tedy proti otiskům pod všemi
 *    pokoleními klíče. Suppression řádek nese jedno pokolení a přepočítat mu ho
 *    nejde; kontakt nese všechna, protože jeho plaintext máme. S jedním otiskem
 *    by první rotace SECRET_KEY ochranu tiše odřízla.
 */

/** Stejný tvar jako `ALIAS_PATTERN` v kompilátoru segmentů: písmeno a nejvýš deset znaků. */
const ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,9}$/;

/**
 * Vrátí `EXISTS (...)` nad tabulkou `suppressions` pro kontakt pod daným aliasem.
 * Text neobsahuje ani jeden parametr, takže se dá vložit do dotazu s libovolným
 * číslováním placeholderů.
 *
 * Alias se ověřuje, protože se skládá do SQL textem. Jediné povolené znaky jsou
 * malá písmena, číslice a podtržítko, takže se sem nedá propašovat konec dotazu.
 */
export function suppressedExistsSql(contactAlias: string): string {
  if (!ALIAS_PATTERN.test(contactAlias)) throw new Error(`invalid alias: ${contactAlias}`);
  const a = contactAlias;
  return (
    `EXISTS (SELECT 1 FROM suppressions su ` +
    `WHERE su.workspace_id = ${a}.workspace_id ` +
    `AND su.removed_at IS NULL ` +
    `AND (su.email = ${a}.email OR su.fingerprint = ANY(${a}.email_fingerprints)))`
  );
}
