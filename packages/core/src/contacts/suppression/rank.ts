import { sql, type SQL } from 'drizzle-orm';

/**
 * Otevřený výčet důvodů blokace. Rozšíření je čistá migrace omezení a nevyžaduje
 * synchronizaci s ostatními částmi, protože hodnotu žádná jiná část nečte jako
 * řídicí údaj. Nová hodnota se ale MUSÍ objevit tady i v matici odebrání, jinak
 * spadne test níž.
 */
export const SUPPRESSION_REASONS = [
  'hard_bounce',
  'soft_bounce_threshold',
  'complaint',
  'manual',
  'global_unsubscribe',
  'one_click_unsubscribe',
  'invalid',
  'import',
  'gdpr_erasure',
  'ses_suppressed',
] as const;

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/**
 * Prioritní žebříček, odshora nejpřísnější. JEDINÝ zdroj pravdy o tom, který důvod
 * je přísnější; hodnota mimo něj je chyba v CI, aby se přidání důvodu nedalo
 * zapomenout doplnit sem.
 *
 * Povýšení je jednosměrné: adresa blokovaná ručně, na kterou přijde stížnost, se
 * povýší na complaint a od té chvíle ji nejde odebrat vůbec. Opačný směr je zakázaný:
 * complaint, na kterou přijde hard_bounce, si complaint ponechá.
 */
export const SUPPRESSION_RANK: readonly SuppressionReason[] = [
  'gdpr_erasure',
  'complaint',
  'hard_bounce',
  'ses_suppressed',
  'global_unsubscribe',
  'one_click_unsubscribe',
  'soft_bounce_threshold',
  'invalid',
  'import',
  'manual',
];

export function rankOf(reason: SuppressionReason): number {
  const index = SUPPRESSION_RANK.indexOf(reason);
  if (index < 0) {
    throw new Error(
      `Důvod "${reason}" není v prioritním žebříčku suppression. Přidání důvodu bez ` +
        'doplnění žebříčku znamená, že povýšení nebude fungovat a přísnější ochrana ' +
        'se tiše ztratí.',
    );
  }
  return index;
}

/** Je nový důvod přísnější než stávající? Rovnost není přísnější. */
export function isStricter(next: SuppressionReason, current: SuppressionReason): boolean {
  return rankOf(next) < rankOf(current);
}

/**
 * Týž žebříček jako SQL výraz, vygenerovaný z TÉŽE konstanty.
 *
 * Existuje proto, že klauzule ON CONFLICT DO UPDATE potřebuje pořadí důvodu, který
 * je právě v tabulce, a ten se v JavaScriptu nedá zjistit: hodnota vznikne až uvnitř
 * příkazu. Dřívější znění plánu to řešilo poddotazem do pomocné tabulky
 * `suppression_rank` a k ní si vyžádalo migraci v P03. Tabulka nikdy nevznikla,
 * takže `suppressions.add` padal na `42P01` při KAŽDÉM tvrdém odrazu, stížnosti,
 * globálním odhlášení i výmazu podle článku 17.
 *
 * Výraz sestavený z konstanty je lepší i kdyby tabulka existovala: nemůže se s kódem
 * rozejít, nepotřebuje jedenáctý řádek ve whitelistu tabulek bez `workspace_id`
 * a ušetří poddotaz na každém ze tří míst, kde se pořadí porovnává.
 *
 * `sql.raw` je tu bezpečné, protože jediným vstupem je zmrazená konstanta z tohohle
 * souboru. Kontrola níž to i tak vynucuje, aby se hodnota nedala podstrčit později.
 */
export function rankCaseSql(column: 'suppressions.reason' | 'excluded.reason'): SQL {
  for (const reason of SUPPRESSION_RANK) {
    if (!/^[a-z_]+$/.test(reason)) {
      throw new Error(`důvod "${reason}" nemá tvar, který se smí vložit do SQL literálu`);
    }
  }
  const whens = SUPPRESSION_RANK.map((reason, index) => `WHEN '${reason}' THEN ${index}`).join(' ');
  return sql.raw(`CASE ${column} ${whens} ELSE ${SUPPRESSION_RANK.length} END`);
}
