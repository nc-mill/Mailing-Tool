/** Technická klasifikace řádku `templates.kind`. */
export type TemplateKind = 'campaign' | 'transactional' | 'system' | 'page';

/** Sada pravidel, podle které se dokument kontroluje a kompiluje. */
export type ValidationProfile = 'campaign' | 'transactional' | 'page';

/**
 * Kódy nálezů, které vydává JEN profil `page`.
 *
 * Bydlí pohromadě a v tomhle balíčku schválně. Zákazy vyhodnocuje validátor
 * dokumentu, který nesmí sahat na databázi ani na překlady, a kdyby si každé
 * pravidlo psalo řetězec u sebe, překlep by se poznal až tím, že editor ukáže
 * holý kód místo věty. Kdo kódy zobrazuje (katalog chyb v jádře, seznam kódů
 * v editoru, překladové katalogy), bere je odsud, ne z paměti.
 *
 * Zákazy mají KAŽDÝ SVŮJ KÓD, ne jeden společný „na stránce to nesmí být":
 * uživatel, kterému editor odmítne uložit stránku, potřebuje vědět, jestli
 * odstranit patičku nebo blok HTML, a jsou to dva různé důvody (patička na
 * veřejné stránce nedává smysl, HTML je bezpečnostní rozhodnutí).
 */
export const PAGE_ISSUE_CODES = {
  /** Blok patičky s odhlašovacím odkazem v dokumentu stránky. */
  footerForbidden: 'content_footer_forbidden_on_page',
  /** Blok syrového HTML v dokumentu stránky. */
  htmlForbidden: 'content_html_forbidden_on_page',
  /** Proměnná, kterou povrch stránky nedodá, takže by se vykreslila jako prázdno. */
  variableNotOnSurface: 'content_variable_not_on_surface',
} as const;

/**
 * Profil, podle kterého se dokument kontroluje a kompiluje.
 *
 * NENÍ to totéž co `templates.kind`. `kind` klasifikuje ŘÁDEK (kdo ho vlastní
 * a jestli patří do knihovny), kdežto profil je sada pravidel pro dokument.
 *
 * `'system'` označuje PRACOVNÍ OBSAH KAMPANĚ, tedy řádek, který si vyrobila
 * aplikace, aby měl editor co upravovat, a který se nesmí objevit v knihovně
 * šablon. Takový dokument je obsahem kampaně, takže se musí kontrolovat jako
 * kampaň. Kdyby se kontroloval systémovým profilem, dopadlo by to takhle:
 *
 * - chybějící odhlašovací odkaz by editor hlásil jako VAROVÁNÍ, jenže kompilace
 *   kampaně (ta jede natvrdo profilem `campaign`) ho hlásí jako CHYBU. Uživatel
 *   by si e-mail dopsal, editor by mlčel a odeslání by pak spadlo.
 * - blok HTML by editor zakázal (`content_raw_html_forbidden`), přestože
 *   v kampani je HTML povolené a zkompiluje se. Byla by to vymyšlená chyba
 *   nad blokem, který je v paletě.
 *
 * PROČ TAHLE FUNKCE BYDLÍ TADY, a ne v doméně šablon: potřebuje ji i EDITOR
 * V PROHLÍŽEČI. Doména šablon sahá na databázi přes drizzle, takže se do
 * prohlížeče nedostane, a druhá kopie mapování by znamenala, že si editor
 * a server můžou o téže šabloně myslet každý něco jiného. Přesně to se stalo:
 * klientská validace jela vždy jako `campaign`, takže uživatel v editoru
 * neuložil obsah, který server přijme. `packages/emails` je bez IO a validaci
 * dokumentu vlastní, takže je to jediné místo, kam mapování patří.
 *
 * `'page'` je VEŘEJNÁ STRÁNKA, ne e-mail (děkovací stránka formuláře, stránka
 * po potvrzení přihlášení a spol.). Vlastní profil má proto, že pravidla kampaně
 * na ni nesedí a mapovat ji na `campaign` by dopadlo takhle:
 *
 * - chybějící odhlašovací odkaz by byl CHYBA, takže by se nedala uložit stránka,
 *   na kterou se z odhlášení vůbec nechodí,
 * - prošel by blok patičky a blok syrového HTML, přestože stránka běží na NAŠÍ
 *   doméně a vložený obsah v ní může předstírat cizí značku nebo přihlašovací
 *   pole; autorem přitom nemusí být majitel projektu, stačí člen s právem
 *   upravovat formuláře.
 */
export function validationProfileFor(kind: TemplateKind): ValidationProfile {
  if (kind === 'transactional') return 'transactional';
  if (kind === 'page') return 'page';
  return 'campaign';
}
