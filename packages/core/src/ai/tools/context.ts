const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;

function canonical(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export type ConversationTurn = { role: 'user' | 'assistant' | 'system' | 'tool'; text: string };

/** Množina adres, které v téhle konverzaci napsal uživatel. Nic jiného se nepočítá. */
export function collectUserUrls(turns: readonly ConversationTurn[]): Set<string> {
  const urls = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    for (const match of turn.text.match(URL_PATTERN) ?? []) {
      const normalized = canonical(match);
      if (normalized !== null) urls.add(normalized);
    }
  }
  return urls;
}

/**
 * Uznáváme shodu hostu, ne přesnou shodu adresy: uživatel typicky napíše
 * kořen webu a model si vyžádá podstránku. Porovnává se celý host, ne
 * podřetězec, jinak by `kolo-shop.cz.zlo.example` prošel.
 */
export function isUrlFromUser(candidate: string, userUrls: ReadonlySet<string>): boolean {
  const normalized = canonical(candidate);
  if (normalized === null) return false;
  const candidateHost = new URL(normalized).hostname;
  for (const known of userUrls) {
    if (new URL(known).hostname === candidateHost) return true;
  }
  return false;
}
