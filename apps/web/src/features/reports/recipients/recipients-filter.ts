export const ALL_FILTERS = [
  'all',
  'opened',
  'clicked',
  'not_opened',
  'not_clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'machine_open_only',
] as const;

export type RecipientFilter = (typeof ALL_FILTERS)[number];

export type ContactState = 'active' | 'deleted' | 'erased';

export function parseFilter(value: string | null): RecipientFilter {
  return (ALL_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as RecipientFilter)
    : 'all';
}

/**
 * Filtr, který se opírá o vypnuté měření, by vždy vrátil prázdno a uživatel
 * by si myslel, že nikdo neotevřel. Nenabízí se vůbec.
 */
export function availableFilters(tracking: {
  trackOpens: boolean;
  trackClicks: boolean;
}): RecipientFilter[] {
  const filters: RecipientFilter[] = ['all'];
  if (tracking.trackOpens) filters.push('opened', 'not_opened', 'machine_open_only');
  if (tracking.trackClicks) filters.push('clicked', 'not_clicked');
  filters.push('bounced', 'complained', 'unsubscribed');
  return filters;
}

/** Smazaný ani anonymizovaný kontakt se nikdy nezobrazí jako prázdná buňka. */
export function contactLabelKey(state: ContactState): string | null {
  if (state === 'deleted') return 'report.recipients.deletedContact';
  if (state === 'erased') return 'report.recipients.erasedContact';
  return null;
}

/**
 * Klíč popisku filtru v katalogu. Převod `machine_open_only` na
 * `filterMachineOpenOnly` je tady, ne inline v komponentě, aby se dal otestovat
 * bez prohlížeče: překlep by se jinak projevil až chybějícím textem na tlačítku.
 */
export function filterLabelKey(filter: RecipientFilter): string {
  const camel = filter.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());
  return `report.recipients.filter${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}
