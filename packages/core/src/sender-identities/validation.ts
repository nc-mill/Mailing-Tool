/**
 * Kontroly předvolby odesílatele, které nejsou o tvaru, ale o smyslu.
 *
 * Tvar (délky, zavináč, malá písmena) hlídá zod v `api/senders.routes.ts`
 * a poslední pojistkou jsou omezení `ck_sender_identities__*` v databázi.
 * Tenhle soubor řeší to, co ani jedno z těch dvou míst neumí: vztah mezi
 * adresou odesílatele a odesílací doménou.
 *
 * Je to čistá funkce bez databáze schválně, aby se dala otestovat bez
 * kontejneru a aby ji uměla použít i obrazovka, až bude chtít varovat dřív,
 * než uživatel klikne na Uložit.
 */

/**
 * Doménová část adresy, malými písmeny. `null` znamená, že to není adresa
 * s jedním zavináčem, tedy že se s ní nedá dál pracovat.
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (domain.includes('@') || domain.startsWith('.') || domain.endsWith('.')) return null;
  return domain;
}

/**
 * Patří adresa do téhle odesílací domény?
 *
 * PODDOMÉNA SE POČÍTÁ, a není to shovívavost. Amazon SES ověřením domény
 * `firma.cz` pokrývá i `news.firma.cz`: identitu poddomény zakládat nemusíte
 * a podepisování DKIM funguje. Kdyby tahle funkce trvala na doslovné shodě,
 * odmítla by adresu, ze které se prokazatelně odesílá, a uživatel by neměl jak
 * ji zadat jinak než tím, že by si poddoménu přidal jako druhou doménu.
 *
 * Porovnává se po tečce, ne `endsWith`. `mojefirma.cz` končí na `firma.cz`,
 * a je to úplně jiná doména.
 */
export function emailBelongsToDomain(email: string, domain: string): boolean {
  const host = emailDomain(email);
  if (host === null) return false;
  const root = domain.toLowerCase().replace(/\.$/, '');
  if (root === '') return false;
  return host === root || host.endsWith(`.${root}`);
}

export type SenderIdentityCheckInput = {
  fromEmail: string;
  /** Doména vybraného `sender_domains` řádku, tak jak je uložená. */
  domain: string;
};

export type SenderIdentityCheckFailure = {
  /** Cesta na pole, aby chyba dosedla k tomu vstupu, který ji způsobil. */
  path: 'from_email';
  code: 'email_outside_domain';
  /** Doména, kterou jsme v adrese našli. Prázdno u adresy bez zavináče. */
  emailDomain: string;
};

/**
 * `null` znamená v pořádku. Vrací se objekt, ne výjimka, aby si volající sám
 * rozhodl, jestli to má být 422 z API, nebo jen varování v obrazovce.
 */
export function checkSenderIdentity(
  input: SenderIdentityCheckInput,
): SenderIdentityCheckFailure | null {
  if (emailBelongsToDomain(input.fromEmail, input.domain)) return null;
  return {
    path: 'from_email',
    code: 'email_outside_domain',
    emailDomain: emailDomain(input.fromEmail) ?? '',
  };
}
