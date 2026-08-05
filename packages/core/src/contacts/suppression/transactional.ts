import { SUPPRESSION_REASONS, type SuppressionReason } from './rank';

/**
 * Které důvody blokace platí i pro transakční poštu.
 *
 * JEDINÝ ZDROJ PRAVDY pro tohle rozhodnutí na straně TypeScriptu. Go protějšek
 * je `transactionalBlocks` v `apps/sender/internal/outbox/suppression.go` a musí
 * dávat stejné odpovědi. Kdyby se rozešly, sender propustí, co endpoint zablokoval,
 * nebo naopak, a projeví se to tím, že člověku nedojde reset hesla.
 *
 * PROČ TO ROZLIŠENÍ VŮBEC JE. Dnešní suppression list je jednolitý: kdo se odhlásil
 * z newsletteru, nedostane ani reset hesla. Pro transakční poštu je to špatně
 * i právně: odhlášení z marketingu není odvolání souhlasu se zpracováním
 * a transakční sdělení je plnění smlouvy nebo oprávněný zájem.
 *
 * Rozhodnutí zadavatele z 5. 8. 2026.
 */

/**
 * Tvrdé důvody. Blokují VŠECHNO včetně transakční pošty.
 *
 * `hard_bounce`, `ses_suppressed` a `invalid`: adresa neexistuje nebo ji provider
 * stejně odmítne, opakované odesílání ničí reputaci a vede k zablokování účtu.
 * `soft_bounce_threshold`: opakované měkké odrazy jsou nakonec totéž co tvrdé.
 * `complaint`: stížnost na spam se u AWS počítá napříč proudy.
 * `gdpr_erasure`: výmaz je výmaz, tady žádný oprávněný zájem není.
 */
export const TRANSACTIONAL_BLOCKING_REASONS = [
  'gdpr_erasure',
  'complaint',
  'hard_bounce',
  'ses_suppressed',
  'soft_bounce_threshold',
  'invalid',
] as const satisfies readonly SuppressionReason[];

/**
 * Odhlášení z marketingu. Transakční poštu NEBLOKUJE, ať přišlo kterýmkoli
 * kanálem. Je to jádro celého rozlišení.
 */
export const TRANSACTIONAL_MARKETING_REASONS = [
  'global_unsubscribe',
  'one_click_unsubscribe',
] as const satisfies readonly SuppressionReason[];

/**
 * Propustit, ale nahlas. U ruční blokace ani u řádku z importu nejde poznat
 * záměr: bývá marketingový, ale nemusí. Volající dostane varování, ne chybu,
 * aby se dalo poznat, že se to děje, a případně to nastavením utáhnout.
 */
export const TRANSACTIONAL_WARNING_REASONS = [
  'manual',
  'import',
] as const satisfies readonly SuppressionReason[];

export type TransactionalSuppressionVerdict = 'block' | 'allow' | 'allow_with_warning';

/** Smí transakční zpráva odejít na adresu blokovanou z tohohle důvodu? */
export function transactionalVerdict(reason: string): TransactionalSuppressionVerdict {
  if ((TRANSACTIONAL_BLOCKING_REASONS as readonly string[]).includes(reason)) return 'block';
  if ((TRANSACTIONAL_WARNING_REASONS as readonly string[]).includes(reason)) {
    return 'allow_with_warning';
  }
  if ((TRANSACTIONAL_MARKETING_REASONS as readonly string[]).includes(reason)) return 'allow';
  // Neznámý důvod BLOKUJE. Nový důvod v `SUPPRESSION_REASONS` bez zatřídění sem
  // je chyba, kterou chytí test níž, ale kdyby se přesto dostal do produkce,
  // bezpečnější je zprávu neposlat než ji poslat.
  return 'block';
}

/**
 * Kontrola úplnosti. Existuje proto, aby přidání důvodu do `SUPPRESSION_REASONS`
 * bez zatřídění sem spadlo v testu, ne až v provozu.
 */
export function unclassifiedSuppressionReasons(): SuppressionReason[] {
  const known = new Set<string>([
    ...TRANSACTIONAL_BLOCKING_REASONS,
    ...TRANSACTIONAL_MARKETING_REASONS,
    ...TRANSACTIONAL_WARNING_REASONS,
  ]);
  return SUPPRESSION_REASONS.filter((reason) => !known.has(reason));
}
