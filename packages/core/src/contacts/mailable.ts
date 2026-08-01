import type { ContactStatus } from './types';

/**
 * Jediný stav kontaktu, který smí dostat kampaň. Hodnota 'subscribed' NEEXISTUJE
 * a nikdy neexistovala; kdo ji v dotazu použije, dostane nula řádků a kampaň
 * neodejde nikomu.
 */
export const MAILABLE_STATUS: ContactStatus = 'active';

export type MailabilityInput = {
  status: ContactStatus;
  deletedAt: Date | null;
  processingRestricted: boolean;
  /** Aktivní suppression záznam, nebo null. */
  suppression: { reason: string } | null;
  /** Přihlášení na cílovém seznamu. null znamená kampaň na segment bez seznamu. */
  subscription: { status: string; snoozeUntil: Date | null } | null;
  /** Okamžik, ke kterému se rozhoduje. Výchozí je teď. */
  asOf?: Date;
};

export type MailabilityResult =
  | { mailable: true }
  | {
      mailable: false;
      blockedBy:
        'suppression' | 'deleted' | 'processing_restricted' | 'subscription' | 'snoozed' | 'status';
    };

/**
 * Autoritativní brána "smí se na tenhle kontakt poslat" podle kapitoly 4.1.6 části 2.
 * Kapitola je označená jako normativní a výslovně zakazuje definovat tohle znovu jinde.
 *
 * Brána je VRSTVENÁ a contacts.status v ní není první:
 *   1. suppressions, zákaz platný pro celý projekt; kontroluje se vždy,
 *      i kdyby byl status 'active',
 *   2. deleted_at a processing_restricted, tvrdé vyloučení bez výjimky,
 *   3. list_subscriptions.status = 'confirmed' plus snooze, pro kampaň na seznam;
 *      TOHLE je skutečná brána, ne contacts.status,
 *   4. contacts.status = 'active' pro kampaň na segment bez seznamu.
 *
 * contacts.status je odvozený souhrnný údaj pro zobrazení a levné filtrování, ne
 * bezpečnostní brána. Kdo staví publikum, nesmí se na něj spoléhat sám o sobě.
 */
export function evaluateMailability(input: MailabilityInput): MailabilityResult {
  const asOf = input.asOf ?? new Date();

  if (input.suppression !== null) return { mailable: false, blockedBy: 'suppression' };
  if (input.deletedAt !== null) return { mailable: false, blockedBy: 'deleted' };
  if (input.processingRestricted) return { mailable: false, blockedBy: 'processing_restricted' };

  if (input.subscription !== null) {
    if (input.subscription.status !== 'confirmed') {
      return { mailable: false, blockedBy: 'subscription' };
    }
    if (input.subscription.snoozeUntil !== null && input.subscription.snoozeUntil > asOf) {
      return { mailable: false, blockedBy: 'snoozed' };
    }
    return { mailable: true };
  }

  if (input.status !== MAILABLE_STATUS) return { mailable: false, blockedBy: 'status' };
  return { mailable: true };
}

/** Zkratka pro volající, které zajímá jen ano/ne. Pravidla jsou v `evaluateMailability`. */
export function isMailable(input: MailabilityInput): boolean {
  return evaluateMailability(input).mailable;
}
