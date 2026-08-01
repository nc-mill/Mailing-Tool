/**
 * Co všechno se rozbije smazáním vlastního pole. Zdroje jsou tři různé domény:
 * segmenty a formuláře si dohledá tahle část, šablony a naplánované kampaně se čtou
 * ze sloupců `templates.used_fields` a `campaigns.compiled_fields`.
 */
export type FieldImpact = {
  /** Kolik kontaktů má klíč vyplněný. */
  contacts_with_value: number;
  segments: { id: string; name: string }[];
  templates: { id: string; name: string; usages: number }[];
  campaigns_scheduled: { id: string; name: string }[];
  forms: { id: string; name: string }[];
};

/** Je smazání zakázané? Naplánovaná kampaň je tvrdá překážka, ne varování. */
export function isDeletionBlocked(impact: FieldImpact): boolean {
  return impact.campaigns_scheduled.length > 0;
}
