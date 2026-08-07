export type ApiTimelineItem = {
  id: string;
  occurred_at: string;
  source: string;
  type: string;
  title: string;
  detail?: Record<string, unknown>;
  campaign?: { id: string; name: string };
  session_id?: string;
  reliability?: 'confirmed' | 'machine';
};

export type GroupedItem = ApiTimelineItem & {
  groupCount?: number | undefined;
  children?: ApiTimelineItem[] | undefined;
};

/**
 * Šest zobrazení stránky během čtyř minut je jeden rozbalitelný řádek.
 * Bez toho web tracking osu zaplaví a e-mailové položky v ní zmizí.
 * Shlukují se jen sousední webové položky téže session, nikdy e-maily.
 */
export function groupWebSeries(items: ApiTimelineItem[]): GroupedItem[] {
  const result: GroupedItem[] = [];

  for (const item of items) {
    const previous = result[result.length - 1];
    const groupable = item.source === 'web' && typeof item.session_id === 'string';
    const sameGroup =
      groupable && previous?.source === 'web' && previous.session_id === item.session_id;

    if (sameGroup && previous) {
      previous.children = [...(previous.children ?? [previous]), item];
      previous.groupCount = previous.children.length;
      continue;
    }

    result.push(groupable ? { ...item, groupCount: 1, children: [item] } : { ...item });
  }

  return result.map((item) =>
    item.groupCount === 1 ? { ...item, groupCount: undefined, children: undefined } : item,
  );
}

/**
 * Výčet ikon vlastní komponenta časové osy, tenhle soubor ho jen používá.
 * Vlastní kopie by znamenala, že se význam „otevřený e-mail" dá pojmenovat
 * dvakrát a pokaždé jinak.
 */
export type { TimelineIcon } from '@mlain/ui/patterns/timeline';
import type { TimelineIcon } from '@mlain/ui/patterns/timeline';

const ICONS: Record<string, TimelineIcon> = {
  message_sent: 'mail',
  message_delivered: 'mail',
  message_opened: 'open',
  message_clicked: 'click',
  /*
   * Kliknutí na SYSTÉMOVÝ odkaz z patičky. Do 7. 8. 2026 tu tyhle tři typy
   * chyběly, takže padaly na neutrální ikonu, přestože jde o proklik jako
   * každý jiný. Vlastní věty v katalogu mají, ikonu neměly.
   *
   * Odhlášení samo je `message_unsubscribed` a to je změna stavu kontaktu,
   * proto má ikonu kontaktu. Tohle je jen otevření stránky.
   */
  message_clicked_unsubscribe_page: 'click',
  message_clicked_preferences: 'click',
  message_clicked_webview: 'click',
  message_failed: 'problem',
  message_bounced: 'problem',
  message_complained: 'problem',
  message_unsubscribed: 'contact',
  page_view: 'web',
  session_started: 'web',
  contact_created: 'contact',
  list_subscribed: 'contact',
  list_unsubscribed: 'contact',
  consent_granted: 'consent',
  consent_withdrawn: 'consent',
};

/** Otevřený výčet: neznámý typ dostane neutrální ikonu a zobrazí se. */
export function iconFor(type: string, _source: string): TimelineIcon {
  return ICONS[type] ?? 'generic';
}
