/**
 * Otisk pěti údajů o odesílateli a hledání předvolby, které odpovídá.
 *
 * PROČ TO EXISTUJE. Kampaň drží `sender_identity_id`, tedy poznámku „tyhle
 * údaje vznikly z předvolby X". Pole `from_name`, `from_email`, `reply_to`,
 * odesílací účet a doména jdou přitom ve formuláři kdykoli přepsat ručně,
 * a od té chvíle by ta poznámka lhala: rozbalovací seznam by ukazoval
 * „Newsletter", zatímco v polích by stálo něco úplně jiného.
 *
 * Odkaz se proto při každém uložení ODVOZUJE Z HODNOT, ne z toho, co bylo
 * v odkazu předtím. Shodují-li se údaje kampaně s některou předvolbou, odkaz
 * na ni se zapíše; jakmile se rozejdou, zapíše se `null` a seznam poctivě
 * ukáže „Vyplněno ručně". Vedlejším ziskem je, že ručně vyplněná kampaň, která
 * náhodou sedí na uloženou předvolbu, se k ní přihlásí sama.
 *
 * Modul je SDÍLENÝ mezi formulářem v prohlížeči a serverovou akcí. Kdyby si
 * každá strana skládala otisk po svém, rozešly by se v maličkosti (velikost
 * písmen v adrese, mezera na konci) a odkaz by mizel bez příčiny.
 */

export type SenderValues = {
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
};

/** Jedna položka seznamu předvoleb tak, jak putuje skrytým polem formuláře. */
export type SenderIdentityFingerprint = { id: string; fingerprint: string };

/**
 * Otisk sady údajů.
 *
 * Normalizuje se přesně tím, čím se liší zápis téhož: ořezanou mezerou a
 * velikostí písmen v adresách. `JSON.stringify` pole je jednoznačný oddělovač,
 * takže se hodnota s uvozovkou nebo svislítkem nemůže přelít do sousední.
 * Prázdno a `null` jsou tu totéž: obojí znamená „nevyplněno".
 */
export function senderFingerprint(values: SenderValues): string {
  return JSON.stringify([
    values.from_name.trim(),
    values.from_email.trim().toLowerCase(),
    (values.reply_to ?? '').trim().toLowerCase(),
    values.provider_id ?? '',
    values.sender_domain_id ?? '',
  ]);
}

export function encodeSenderIdentityFingerprints(
  identities: readonly (SenderValues & { id: string })[],
): string {
  return JSON.stringify(
    identities.map((identity) => [identity.id, senderFingerprint(identity)] as const),
  );
}

/**
 * Rozbalení skrytého pole. Je ZÁMĚRNĚ tolerantní: hodnota přichází z formuláře,
 * tedy z prohlížeče, a nesmyslný obsah nesmí shodit uložení celého nastavení.
 * Prázdný výsledek znamená „o předvolbách nevím nic" a volající na něj reaguje
 * tím, že odkaz nechá být.
 */
export function decodeSenderIdentityFingerprints(raw: string): SenderIdentityFingerprint[] {
  if (raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SenderIdentityFingerprint[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue;
    const [id, fingerprint] = entry;
    if (typeof id === 'string' && typeof fingerprint === 'string' && id !== '') {
      out.push({ id, fingerprint });
    }
  }
  return out;
}

/**
 * Předvolba, na kterou se má kampaň odkazovat.
 *
 * `preferId` je odkaz, který kampaň má teď. Rozhoduje jen při remíze, tedy když
 * na týž otisk sedí víc předvoleb (dvě různá jména nad stejnou adresou je
 * legitimní stav). Bez něj by uložení nastavení přeskakovalo mezi nimi podle
 * pořadí v seznamu a uživatel by viděl, jak se mu výběr sám mění.
 */
export function matchSenderIdentity(
  identities: readonly SenderIdentityFingerprint[],
  fingerprint: string,
  preferId: string,
): string | null {
  const matches = identities.filter((identity) => identity.fingerprint === fingerprint);
  if (matches.length === 0) return null;
  if (matches.some((identity) => identity.id === preferId)) return preferId;
  return matches[0]!.id;
}
