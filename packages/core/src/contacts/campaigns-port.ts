/**
 * Port na `revokePendingMessages`, který podle kapitoly 2 plánu vlastní P13 (kampaně)
 * a vystavuje ho jako `@mlain/core/campaigns`.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POŘADÍM VLN. Modul `@mlain/core/campaigns` v repozitáři
 * zatím není a tenhle plán ho psát nesmí. Import neexistující podcesty by shodil celou
 * doménu kontaktů už při načtení, takže by nešlo odhlásit vůbec nikoho.
 *
 * Řeší se to jedním registračním bodem: dokud P13 svou implementaci nezaregistruje,
 * je volání zaznamenané a bez efektu, protože žádné čekající zprávy zatím neexistují
 * (fronta odesílání je taky součást P13). Jakmile P13 dorazí, zavolá
 * `registerRevokePendingMessages(...)` při startu procesu a nic dalšího se nemění.
 *
 * Tvar vstupu je NORMATIVNÍ a je převzatý z plánu doslova, protože na něm stojí
 * kritérium 79: `listId` se předává vždy, i když je `null`.
 */
/**
 * Důvody zrušení čekajících zpráv. Řetězce jsou převzaté z plánu doslova a NESLUČUJÍ SE:
 * článek 17 (contact_anonymized) a článek 18 (processing_restricted) jsou dva různé
 * právní důvody s různou vratností a report kampaně je musí umět odlišit.
 */
export type RevokeReason =
  'unsubscribed' | 'suppressed' | 'contact_anonymized' | 'processing_restricted';

export type RevokePendingMessagesInput = {
  workspaceId: string;
  contactIds: string[];
  /** Rozsah. `null` znamená všechny čekající zprávy kontaktu. Klíč nikdy nechybí. */
  listId: string | null;
  reason: RevokeReason;
};

export type RevokePendingMessagesFn = (
  input: RevokePendingMessagesInput,
) => Promise<{ revoked: number }>;

let implementation: RevokePendingMessagesFn | null = null;

/** Registruje P13 při startu procesu. Druhá registrace přepíše první. */
export function registerRevokePendingMessages(fn: RevokePendingMessagesFn): void {
  implementation = fn;
}

/** Jen pro testy: vrátí port do výchozího stavu. */
export function resetRevokePendingMessages(): void {
  implementation = null;
}

export async function revokePendingMessages(
  input: RevokePendingMessagesInput,
): Promise<{ revoked: number }> {
  if (implementation === null) return { revoked: 0 };
  return implementation(input);
}
