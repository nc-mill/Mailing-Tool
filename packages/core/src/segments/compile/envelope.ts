import { suppressedExistsSql } from '../../contacts/suppression/predicate';
import type { ParamBag } from './params';
import { assertAlias } from './columns';

/** workspace_id, asOf, timezone. Přidává je volající před kompilací uzlů. */
export const FIXED_PARAM_COUNT = 3;

/**
 * Výčet podmínek obálky jako data, aby šlo testem ověřit ÚPLNOST, ne jen
 * přítomnost jednotlivých řetězců. Test na „obsahuje deleted_at" se dá obejít
 * tím, že se podmínka smaže i s testem; tenhle seznam se musí změnit vědomě.
 */
export const ENVELOPE_CONDITIONS = [
  'workspace_id',
  'deleted_at',
  'anonymized_at',
  'status_not_deleted',
  'processing_restricted',
  'suppressions',
] as const;

/**
 * Jediná verze obálky, jakou tenhle produkt má. Platí pro compileAudienceToSql,
 * countSegment i listSegmentContacts bez rozdílu, takže náhled segmentu a publikum
 * kampaně vidí tutéž množinu kontaktů.
 *
 * Podmínku nad `suppressions` obálka NEPÍŠE sama: skládá ji `suppressedExistsSql`
 * z `contacts/suppression/predicate.ts`, které je jediné místo, kde ten predikát
 * existuje. Důvod i všechny tři povinné podmínky jsou popsané tam.
 *
 * Anonymizovaný kontakt se vylučuje DVĚMA podmínkami, protože jeden příznak
 * nestačí. Výmaz podle článku 17 řádek NEMAŽE: přepíše `email`, vyprázdní
 * `render_data` a nastaví `anonymized_at`, ale `deleted_at` nastavovat nemusí.
 * Bez `anonymized_at IS NULL` by tedy vymazaný člověk zůstal v publiku a pošta by
 * odešla na neexistující doménu, což je tvrdý odraz a poškozená reputace
 * odesílatele. Hodnota `deleted` ve `status` je druhá cesta k témuž stavu.
 */
export function buildEnvelope(alias: string, audienceSql: string, bag: ParamBag): string {
  assertAlias(alias);
  const ws = bag.ref(1);
  return [
    `SELECT ${alias}.id AS contact_id`,
    `  FROM contacts ${alias}`,
    ` WHERE ${alias}.workspace_id = ${ws}`,
    `   AND ${alias}.deleted_at IS NULL`,
    `   AND ${alias}.anonymized_at IS NULL`,
    `   AND ${alias}.status <> 'deleted'`,
    `   AND ${alias}.processing_restricted = false`,
    `   AND NOT ${suppressedExistsSql(alias)}`,
    `   AND (${audienceSql})`,
  ].join('\n');
}
