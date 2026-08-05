/**
 * Rozbor dávky kontaktů vložené do textového pole.
 *
 * Čistá funkce bez závislosti na Reactu, na síti i na Node: obrazovka z ní jen
 * vykresluje výsledek a testy ji zkoušejí samotnou. Je to schválně, protože
 * shovívavost k oddělovačům je to jediné, co na téhle obrazovce může tiše
 * zkazit data, a chce se testovat na krajních případech, ne přes DOM.
 *
 * Tvar řádku je `e-mail; jméno; příjmení`, přičemž POVINNÝ JE JEN E-MAIL.
 * Řádek smí být i holá adresa. Čtvrtá a další položka se zahazuje.
 */

/**
 * Strop dávky. Není náš, je serverový: `POST /contacts/imports` s tělem JSON
 * odmítá víc než deset tisíc řádků kódem `too_many_rows`. Nechat uživatele
 * vložit sto tisíc řádků a teprve po odeslání mu vrátit chybu by znamenalo
 * zahodit několik minut jeho práce, proto se počet hlídá už při psaní.
 */
export const PASTE_MAX_ROWS = 10_000;

/** Řádek, který se dá naimportovat. Jméno i příjmení smí být prázdné. */
export type PasteRow = {
  /** Číslo řádku v textovém poli, počítáno od jedné VČETNĚ prázdných řádků. */
  lineNumber: number;
  raw: string;
  email: string;
  firstName: string;
  lastName: string;
};

/** Řádek, který nemá použitelnou adresu. Ostatní řádky nezastavuje. */
export type PasteProblem = {
  lineNumber: number;
  raw: string;
  code: 'email_missing' | 'invalid_email' | 'email_too_long';
};

/** Druhý a další výskyt téže adresy uvnitř vložené dávky. */
export type PasteDuplicate = {
  lineNumber: number;
  raw: string;
  email: string;
  /** Řádek, na kterém se adresa objevila poprvé a který se opravdu naimportuje. */
  firstSeenLine: number;
};

export type PasteResult = {
  rows: PasteRow[];
  problems: PasteProblem[];
  duplicates: PasteDuplicate[];
};

/**
 * Bílé znaky včetně nedělitelné mezery, přesně tatáž množina jako
 * v `normalizeEmail` z jádra. Kdyby se lišila, prošla by obrazovkou adresa,
 * kterou server odmítne, nebo naopak.
 */
const WHITESPACE_CLASS =
  ' \\t\\n\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WHITESPACE = new RegExp(`[${WHITESPACE_CLASS}]`);
const WHITESPACE_TRIM = new RegExp(`^[${WHITESPACE_CLASS}]+|[${WHITESPACE_CLASS}]+$`, 'g');
// Řídicí znaky jsou v téhle třídě ZÁMĚRNĚ: adresa, která je obsahuje, se odmítá.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001f\u007f]');
const DISPLAY_NAME_FORM = /^(.*)<([^<>]+)>$/;

/**
 * Oddělovač je středník, ale tolerují se i čárka a tabulátor.
 *
 * Je to schválně: text se do pole nejčastěji dostane kopií z tabulky (tabulátor)
 * nebo z jiného nástroje (čárka) a odmítnout ho jen proto, že uživatel nepřepsal
 * oddělovače, by ho poslalo přepisovat stovky řádků ručně. Žádný z těch tří
 * znaků se přitom v e-mailové adrese ani v českém jméně nevyskytuje.
 */
const SEPARATOR = /[;,\t]/;

type NormalizedEmail = { ok: true; email: string } | { ok: false; code: PasteProblem['code'] };

/**
 * Syntaktická kontrola adresy v prohlížeči.
 *
 * ZÁMĚRNĚ NEVOLÁ `normalizeEmail` z `@mlain/core`: ta importuje `node:url` kvůli
 * převodu IDN domény na punycode, takže by se do klientského balíku nedostala.
 * Pravidla jsou tedy tatáž až na ten převod, který si server udělá sám. Rozdíl
 * je jednosměrný a neškodný: `jan@háčkyčárky.cz` tady projde a server ho přepíše
 * na punycode. Opačným směrem, tedy „obrazovka pustí adresu, kterou server
 * odmítne", se rozejít nemůžou.
 */
function normalizeEmail(raw: string): NormalizedEmail {
  let value = raw.normalize('NFC').replace(WHITESPACE_TRIM, '');

  // Tvar „Jan Novák <jan@example.com>" se rozbalí. Na řádku bez oddělovačů je
  // to jediná podoba, ve které lidé adresu kopírují z poštovního klienta.
  const wrapped = value.match(DISPLAY_NAME_FORM);
  if (wrapped !== null) value = (wrapped[2] ?? '').replace(WHITESPACE_TRIM, '');

  // Malá písmena v celé adrese včetně lokální části, stejně jako v jádře.
  // Bez toho by se „Petr@Example.com" a „petr@example.com" počítaly jako dva
  // různé kontakty, přestože je server sloučí do jednoho.
  value = value.toLowerCase();

  if (value === '') return { ok: false, code: 'email_missing' };
  if (CONTROL.test(value) || WHITESPACE.test(value)) return { ok: false, code: 'invalid_email' };

  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) {
    return { ok: false, code: 'invalid_email' };
  }

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0) return { ok: false, code: 'invalid_email' };
  if (!domain.includes('.')) return { ok: false, code: 'invalid_email' };
  if (/^[-.]/.test(domain) || /[-.]$/.test(domain)) return { ok: false, code: 'invalid_email' };
  if (domain.includes('..')) return { ok: false, code: 'invalid_email' };

  if (value.length > 254) return { ok: false, code: 'email_too_long' };
  if (value.length < 3) return { ok: false, code: 'invalid_email' };

  return { ok: true, email: value };
}

/**
 * Rozdělení řádku na položky.
 *
 * KONCOVÝ ODDĚLOVAČ SE ZAHAZUJE. Řádek `email@example.com; Jmeno; Prijmeni;`
 * je v zadání doslova a bez tohohle by z něj vznikla čtvrtá, prázdná položka.
 * Sama o sobě by nevadila (čtvrtá položka se ignoruje), ale u řádku `a@b.cz;`
 * by prázdné jméno vypadalo jako vyplněné a přepsalo by jméno, které kontakt
 * v projektu už má.
 */
function splitLine(line: string): string[] {
  const parts = line.split(SEPARATOR).map((part) => part.replace(WHITESPACE_TRIM, ''));
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Rozebere vložený text na řádky k importu, na chybné řádky a na duplicity.
 *
 * CHYBNÝ ŘÁDEK NEZASTAVÍ OSTATNÍ. Vrací se všechny tři seznamy najednou, takže
 * obrazovka umí říct „472 v pořádku, 3 s neplatnou adresou, 1 duplicita" ještě
 * před uložením a u chyb ukázat číslo řádku i jeho obsah.
 *
 * U DUPLICITY VYHRÁVÁ PRVNÍ VÝSKYT. Rozhoduje se tady, ne až na serveru, protože
 * jedině tady se dá uživateli ukázat, které konkrétní řádky se zahodí.
 */
export function parsePastedContacts(text: string): PasteResult {
  const rows: PasteRow[] = [];
  const problems: PasteProblem[] = [];
  const duplicates: PasteDuplicate[] = [];
  const firstSeen = new Map<string, number>();

  // Značka pořadí bajtů na začátku vloženého textu je neviditelná, ale
  // v lokální části adresy by ji server odmítl jako řídicí znak.
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const parts = splitLine(line);
    // Prázdný řádek se přeskakuje BEZ HLÁŠENÍ. Mezera mezi skupinami adres je
    // způsob, jakým si lidé text člení, ne chyba, kterou mají opravovat.
    if (parts.length === 0) return;

    const raw = line.trim();
    const normalized = normalizeEmail(parts[0] ?? '');
    if (!normalized.ok) {
      problems.push({ lineNumber, raw, code: normalized.code });
      return;
    }

    const seenAt = firstSeen.get(normalized.email);
    if (seenAt !== undefined) {
      duplicates.push({ lineNumber, raw, email: normalized.email, firstSeenLine: seenAt });
      return;
    }
    firstSeen.set(normalized.email, lineNumber);

    rows.push({
      lineNumber,
      raw,
      email: normalized.email,
      firstName: parts[1] ?? '',
      lastName: parts[2] ?? '',
    });
  });

  return { rows, problems, duplicates };
}
