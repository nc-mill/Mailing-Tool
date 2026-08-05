import type { ContactStatus, UpsertMode } from './types';

export type { ContactStatus };

/**
 * Stavy, ze kterých se NIKDY nepovyšuje zápisem. Přechod zpátky na active je možný
 * jen dvěma cestami: potvrzením dvojího opt-inu konkrétním člověkem, nebo ručním
 * zásahem správce se záznamem v auditu.
 */
const LOCKED_STATUSES: readonly ContactStatus[] = ['unsubscribed', 'bounced', 'complained'];

/** Důvody suppression, u kterých se kontakt nezapisuje vůbec. */
const HARD_BLOCK_REASONS = ['complaint', 'gdpr_erasure'] as const;

export type ExistingContact = {
  email: string;
  status: ContactStatus;
  vocativeLocked: boolean;
  firstName: string | null;
  lastName: string | null;
};

export type IncomingContact = {
  email: string;
  status?: ContactStatus;
  firstName?: string | null;
  lastName?: string | null;
};

export type WriteRulesInput = {
  existing: ExistingContact | null;
  incoming: IncomingContact;
  mode: UpsertMode;
  suppression?: { reason: string } | null;
};

export type WriteRulesResult = {
  email: string;
  status: ContactStatus;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  /** Když je vyplněné, kontakt se nezapisuje a řádek se počítá jako potlačený. */
  rejected?: 'suppressed';
  allowSubscriptions: boolean;
  allowTags: boolean;
  allowConsents: boolean;
  releaseVocativeLock: boolean;
};

/**
 * Šest pravidel z kapitoly 4.1.2 části 2, která platí ve VŠECH režimech a nejdou vypnout.
 * Volá je každý kanál před zápisem: API, formulář, příchozí webhook i import.
 *
 * Funkce nemá a nikdy nesmí mít parametr, kterým by se pravidlo dalo obejít. Pravidla 1,
 * 2 a 3 jsou navíc vynucená DRUHÝM, nezávislým způsobem přímo v SQL upsertu (`repo/contacts.ts`),
 * takže ani zápis, který by tuhle funkci minul, je neporuší.
 */
export function applyWriteRules(input: WriteRulesInput): WriteRulesResult {
  const { existing, incoming, mode, suppression } = input;

  // Pravidlo 4: kontakt na suppression listu se stížností nebo po výmazu podle článku 17
  // se nezapisuje vůbec. U ostatních důvodů se zapíše, ale bez přihlášení a bez souhlasu.
  const hardBlocked =
    suppression !== null &&
    suppression !== undefined &&
    (HARD_BLOCK_REASONS as readonly string[]).includes(suppression.reason);

  if (hardBlocked) {
    return {
      email: existing?.email ?? incoming.email,
      status: existing?.status ?? 'unconfirmed',
      rejected: 'suppressed',
      allowSubscriptions: false,
      allowTags: false,
      allowConsents: false,
      releaseVocativeLock: false,
    };
  }

  const softBlocked = suppression !== null && suppression !== undefined;
  const skip = mode === 'skip';

  // Pravidlo 1: e-mail je klíč a zápisem se nikdy nemění. Změna adresy je samostatná
  // operace POST /contacts/{id}/change-email s vlastní kontrolou kolize a auditem.
  const email = existing?.email ?? incoming.email;

  // Pravidlo 3: status se nikdy nepovyšuje. Bez tohohle pravidla by stačilo znovu
  // naimportovat starý soubor a všichni odhlášení by byli zpátky v rozesílce.
  // Je to nejdůležitější pravidlo celé kapitoly.
  const status =
    existing === null
      ? (incoming.status ?? 'unconfirmed')
      : LOCKED_STATUSES.includes(existing.status)
        ? existing.status
        : (incoming.status ?? existing.status);

  // Pravidlo 6: zamknutý vokativ přežije zápis, dokud se nezmění jméno.
  const releaseVocativeLock =
    existing !== null &&
    existing.vocativeLocked &&
    shouldReleaseVocativeLock(existing, incoming, mode);

  return {
    email,
    status,
    // Pravidlo 2 (slučování attributes po klíčích) se vynucuje v SQL, viz repo/contacts.ts.
    firstName: skip && existing !== null ? existing.firstName : incoming.firstName,
    lastName: skip && existing !== null ? existing.lastName : incoming.lastName,
    // Pravidlo 5: skip se týká JEN polí kontaktu. Přihlášení do seznamů, štítky
    // a záznam souhlasu se aplikují i v něm, protože "přidej tyhle lidi do seznamu,
    // ale nesahej mi na jejich data" je běžný a legitimní požadavek.
    allowSubscriptions: !softBlocked,
    allowTags: true,
    allowConsents: !softBlocked,
    releaseVocativeLock,
  };
}

/**
 * Zámek chrání hodnotu vokativu, ne jméno. Kdyby po změně jména zůstal, kontakt
 * "Jana Nováková" přejmenovaný na "Petr Novák" by dál dostával oslovení "Jano".
 *
 * Změna jen rodu zámek nechává: rod ovlivňuje tvar oslovení příjmením, ne samotný
 * vokativ, který už člověk potvrdil.
 *
 * PRÁZDNÉ JMÉNO VE VSTUPU NENÍ ZMĚNA JMÉNA (oprava hlášené vady „přesun kontaktů do
 * seznamu shodí oslovení"). Cesty, které jméno vůbec nenesou, ho do zápisu posílají
 * jako `null`, ne jako `undefined`: přihlášení do seznamu pracuje s adresou
 * (`lists/subscribe.ts` skládá `input.firstName ?? null`), stejně tak stránka
 * předvoleb i příchozí webhook. Původní podmínka takový zápis vyhodnotila jako
 * „jméno se změnilo z Petr na nic", zámek shodila a kontakt, který měl ručně
 * potvrzené „Petře", se v seznamu naráz tvářil jako neověřený.
 *
 * DOLOŽENO NA ŽIVÉ DATABÁZI: hromadné přidání tří kontaktů do seznamu zapsalo do
 * auditu třikrát `contact.vocative_lock_released` s důvodem `name_changed`, přestože
 * se ani u jednoho z nich jméno nezměnilo.
 *
 * Podmínka teď kopíruje to, co se SKUTEČNĚ stane s daty: v režimech `update`, `skip`
 * a `create` prázdná hodnota jméno v databázi nepřepíše (`coalesce(nullif(excluded
 * .first_name, ''), contacts.first_name)` v `repo/contacts.ts`), takže se nemá o čem
 * rozhodovat. V režimu `overwrite` prázdná hodnota jméno SMAŽE, a tam je uvolnění
 * zámku správně: oslovení „Petře" u kontaktu bez jména nemá základ.
 */
export function shouldReleaseVocativeLock(
  existing: { firstName: string | null; lastName: string | null },
  incoming: { firstName?: string | null | undefined; lastName?: string | null | undefined },
  mode: UpsertMode = 'update',
): boolean {
  const clearing = mode === 'overwrite';
  return (
    nameChanged(existing.firstName, incoming.firstName, clearing) ||
    nameChanged(existing.lastName, incoming.lastName, clearing)
  );
}

/**
 * Změní tenhle zápis jméno v databázi?
 *
 * Porovnává se na oříznuté hodnotě: „Petr " a „Petr" je totéž jméno a rozdíl v bílém
 * znaku nesmí shodit ručně potvrzený tvar. Prázdný řetězec je táž hodnota jako `null`,
 * viz `nonEmpty` v `naming/greeting.ts`.
 */
function nameChanged(
  existing: string | null,
  incoming: string | null | undefined,
  clearing: boolean,
): boolean {
  if (incoming === undefined) return false;
  const next = trimToNull(incoming);
  if (next === null && !clearing) return false;
  return next !== trimToNull(existing);
}

function trimToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
