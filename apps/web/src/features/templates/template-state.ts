/**
 * Co se se šablonou dá dělat.
 *
 * JEDNO MÍSTO, stejně jako `campaigns/campaign-state.ts` a `segments/segment-state.ts`.
 * Podmínka „zapojenou šablonu nejde smazat" byla do 6. 8. 2026 napsaná uvnitř
 * knihovny (`isWired`) a druhá její půlka na serveru (409 `template_in_use`).
 * Řádková nabídka by z ní udělala třetí kopii.
 *
 * Soubor je schválně BEZ `'use client'` a bez komponent, takže se tabulka dá
 * zkoušet bez Reactu a bez katalogu překladů.
 */

/** Zapojení šablony. Prázdná pole znamenají volnou šablonu, ne chybějící data. */
export type TemplateUsage = {
  forms: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string; role: string }>;
};

/** Akce nabízené v řádku knihovny šablon. Pořadí je pořadím v nabídce. */
export type TemplateRowAction = 'edit' | 'duplicate' | 'delete';

/**
 * Šablona, kterou někdo živě rozesílá, se nesmí tvářit jako volná předloha:
 * formulář i seznam z ní čtou při každém odeslání.
 */
export function isTemplateWired(usage: TemplateUsage): boolean {
  return usage.forms.length > 0 || usage.lists.length > 0;
}

/**
 * Které akce dávají u téhle šablony smysl.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Mazání zapojené šablony server
 * odmítne (409 `template_in_use`), takže se u ní položka vůbec neukáže; důvod
 * stojí v řádku ve sloupci „Zapojení", kde je pro celou větu místo.
 *
 * Duplikace se nabízí i u zapojené šablony, a je to záměr: je to jediný způsob,
 * jak z živě rozesílané předlohy vyjít a neriskovat, že se úprava projeví
 * v poště, která odchází teď.
 *
 * Prázdné pole znamená, že se nekreslí ani spouštěč nabídky.
 */
export function templateRowActions(
  template: { usage: TemplateUsage },
  permissions: { write: boolean },
): TemplateRowAction[] {
  if (!permissions.write) return [];
  const actions: TemplateRowAction[] = ['edit', 'duplicate'];
  if (!isTemplateWired(template.usage)) actions.push('delete');
  return actions;
}

/** Akce, které se v nabídce oddělují čarou a kreslí červeně. */
export const DESTRUCTIVE_TEMPLATE_ACTIONS: readonly TemplateRowAction[] = ['delete'];
