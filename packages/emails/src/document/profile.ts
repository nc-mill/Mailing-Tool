/** Technická klasifikace řádku `templates.kind`. */
export type TemplateKind = 'campaign' | 'transactional' | 'system';

/** Sada pravidel, podle které se dokument kontroluje a kompiluje. */
export type ValidationProfile = 'campaign' | 'transactional';

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
 */
export function validationProfileFor(kind: TemplateKind): ValidationProfile {
  return kind === 'transactional' ? 'transactional' : 'campaign';
}
