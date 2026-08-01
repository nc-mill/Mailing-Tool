import type { ContactStatus } from './filters';

export type ContactStateInput = {
  status: ContactStatus;
  processing_restricted: boolean;
  snooze_until: string | null;
  anonymized_at: string | null;
  /** Kdy kontakt do současného stavu přešel. Používá se v doplňující větě. */
  status_changed_at: string;
  restriction_requested_at: string | null;
};

export type ContactAction =
  | 'sendEmail'
  | 'unsubscribe'
  | 'delete'
  | 'export'
  | 'resendConfirmation'
  | 'resubscribe'
  | 'openSuppressions'
  | 'cancelSnooze'
  | 'showRestriction';

export type ContactBadge = {
  labelKey: string;
  tone: 'success' | 'warning' | 'neutral' | 'danger';
  values?: Record<string, string>;
};

export type ContactStateView = {
  badges: ContactBadge[];
  notes: { textKey: string; values: Record<string, string> }[];
  actions: ContactAction[];
  readOnly: boolean;
  restricted: boolean;
  showsPersonalData: boolean;
};

const STATUS_TONE: Record<ContactStatus, ContactBadge['tone']> = {
  active: 'success',
  unconfirmed: 'warning',
  unsubscribed: 'neutral',
  bounced: 'danger',
  complained: 'danger',
  deleted: 'neutral',
};

/**
 * Devět podob detailu podle 8.8.1 části 6. Šest hodnot contacts.status plus tři nezávislé
 * příznaky. Příznaky se ke stavu PŘIDÁVAJÍ, nenahrazují ho: kontakt může být zároveň
 * aktivní a mít omezené zpracování, a uživatel musí vidět obojí.
 *
 * Funkce vrací klíče, ne texty. Překládá se až v komponentě, takže se tenhle soubor
 * dá testovat bez React kontextu a bez katalogu.
 */
export function describeContactState(contact: ContactStateInput): ContactStateView {
  const badges: ContactBadge[] = [
    { labelKey: `status.${contact.status}`, tone: STATUS_TONE[contact.status] },
  ];
  const notes: ContactStateView['notes'] = [];
  const actions: ContactAction[] = [];

  const readOnly = contact.status === 'deleted' || contact.anonymized_at !== null;
  const date = { date: contact.status_changed_at };

  if (contact.status !== 'active') {
    notes.push({ textKey: `statusNote.${contact.status}`, values: date });
  }

  if (!readOnly) {
    // Jednorázový e-mail nesmí odejít kontaktu s omezeným zpracováním. Kdyby akce jen
    // spadla na chybu ze serveru, uživatel by nevěděl proč; proto se nenabízí vůbec
    // a místo ní je vysvětlující blok.
    if (!contact.processing_restricted) actions.push('sendEmail');
    if (contact.status === 'active' || contact.status === 'unconfirmed') {
      actions.push('unsubscribe');
    }
    actions.push('delete');
  }

  actions.push('export');

  if (contact.status === 'unconfirmed' && !readOnly) actions.push('resendConfirmation');
  if (contact.status === 'unsubscribed' && !readOnly) actions.push('resubscribe');
  if (contact.status === 'bounced' || contact.status === 'complained') {
    actions.push('openSuppressions');
  }

  if (contact.processing_restricted) {
    badges.push({ labelKey: 'flag.processingRestricted', tone: 'warning' });
    actions.push('showRestriction');
  }

  if (contact.snooze_until !== null) {
    badges.push({
      labelKey: 'flag.snoozed',
      tone: 'neutral',
      values: { date: contact.snooze_until },
    });
    notes.push({ textKey: 'flagNote.snoozed', values: { date: contact.snooze_until } });
    if (!readOnly) actions.push('cancelSnooze');
  }

  if (contact.anonymized_at !== null) {
    badges.push({ labelKey: 'flag.anonymized', tone: 'neutral' });
    notes.push({ textKey: 'flagNote.anonymized', values: { date: contact.anonymized_at } });
  }

  return {
    badges,
    notes,
    actions,
    readOnly,
    restricted: contact.processing_restricted,
    showsPersonalData: contact.anonymized_at === null,
  };
}
