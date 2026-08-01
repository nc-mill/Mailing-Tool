import type { TimelineRow } from './types';

export type Gender = 'female' | 'male' | 'unknown';

export type Translate = (key: string, values: Record<string, unknown>) => string;

const TITLE_KEYS: Record<string, string> = {
  message_sent: 'timeline.item.messageSent',
  message_failed: 'timeline.item.messageFailed',
  message_delivered: 'timeline.item.messageDelivered',
  message_opened: 'timeline.item.messageOpened',
  message_clicked: 'timeline.item.messageClicked',
  message_bounced: 'timeline.item.messageBounced',
  message_complained: 'timeline.item.messageComplained',
  message_unsubscribed: 'timeline.item.messageUnsubscribed',
  page_view: 'timeline.item.pageView',
  session_started: 'timeline.item.sessionStarted',
  contact_created: 'timeline.item.contactCreated',
  list_subscribed: 'timeline.item.listSubscribed',
  list_unsubscribed: 'timeline.item.listUnsubscribed',
  consent_granted: 'timeline.item.consentGranted',
  consent_withdrawn: 'timeline.item.consentWithdrawn',
};

/**
 * Neznámý typ nesmí shodit odpověď. Dostane obecnou větu s názvem události,
 * aby klient, který o typu nikdy neslyšel, uměl zobrazit aspoň něco smysluplného.
 */
export function titleKey(type: string): string {
  return TITLE_KEYS[type] ?? 'timeline.item.generic';
}

/**
 * Věta se skládá v katalogu ze slotů, ne v kódu ze zřetězených fragmentů.
 * Rod se předává jako slot a ICU `select` v katalogu vybere tvar slovesa.
 * U neznámého rodu je správný tvar podstatné jméno, ne mužský rod: polovina
 * kontaktů jsou ženy.
 */
export function composeTitle(translate: Translate, row: TimelineRow, gender: Gender): string {
  return translate(titleKey(row.type), {
    ...row.slots,
    gender: gender === 'unknown' ? 'other' : gender,
  });
}
