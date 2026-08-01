/**
 * Dopad smazání vlastního pole, fáze 1 dvoufázového smazání ze 4.2.5 části 2.
 *
 * Typ je v samostatném souboru, protože ho čte jak serverová akce (`actions.ts`
 * s direktivou `'use server'`), tak klientská tabulka. Soubor s `'use server'`
 * smí exportovat jen asynchronní funkce, takže typ nesmí bydlet tam.
 */
export type FieldImpact = {
  contacts_with_value: number;
  segments: { id: string; name: string }[];
  templates: { id: string; name: string; usages: number }[];
  campaigns_scheduled: { id: string; name: string }[];
  forms: { id: string; name: string }[];
};
