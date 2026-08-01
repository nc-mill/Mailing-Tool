import { domainToASCII } from 'node:url';

export type NormalizeEmailResult =
  | { ok: true; email: string; displayName?: string }
  | { ok: false; code: 'invalid_email' | 'email_too_long' };

/**
 * Všechny mezery kategorie Zs plus tabulátor a konce řádků.
 *
 * ODCHYLKA OD PLÁNU, JEN TYPOGRAFICKÁ: plán měl znaky v regulárním výrazu doslova.
 * Nedělitelná mezera a úzká nedělitelná mezera jsou v editoru k nerozeznání od obyčejné,
 * takže se tady píšou escape sekvencemi. Množina znaků je táž.
 */
const WHITESPACE_CLASS =
  ' \\t\\n\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WHITESPACE = new RegExp(`[${WHITESPACE_CLASS}]`);
const WHITESPACE_TRIM = new RegExp(`^[${WHITESPACE_CLASS}]+|[${WHITESPACE_CLASS}]+$`, 'g');
// Řídicí znaky jsou v téhle třídě ZÁMĚRNĚ: adresa, která je obsahuje, se odmítá.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const DISPLAY_NAME_FORM = /^(.*)<([^<>]+)>$/;
// Negace ASCII rozsahu, tedy i řídicích znaků. Slouží k detekci IDN domény.
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\u0000-\u007f]/;

/**
 * Normalizuje e-mailovou adresu podle kapitoly 4.1.1 části 2. Sedm kroků v pevném pořadí.
 * Tuhle funkci volá KAŽDÝ kanál (API, formulář, webhook, import, suppression), protože
 * dva různé postupy by z jednoho člověka udělaly dva kontakty.
 *
 * Validace je záměrně jen syntaktická. Žádný DNS ani MX dotaz: prodloužil by import pěti
 * milionů řádků o hodiny a doručitelnost stejně nezaručí.
 */
export function normalizeEmail(raw: string): NormalizeEmailResult {
  // 1. Unicode NFC.
  let value = raw.normalize('NFC');

  // 2. Ořez bílých znaků včetně NBSP.
  value = value.replace(WHITESPACE_TRIM, '');

  // 3. a 4. Rozbalení tvaru s display jménem a odstranění lomených závorek.
  let displayName: string | undefined;
  const wrapped = value.match(DISPLAY_NAME_FORM);
  if (wrapped !== null) {
    const namePart = (wrapped[1] ?? '').replace(WHITESPACE_TRIM, '').replace(/^"|"$/g, '').trim();
    if (namePart.length > 0) displayName = namePart;
    value = (wrapped[2] ?? '').replace(WHITESPACE_TRIM, '');
  }

  // 5. Malá písmena v celém řetězci včetně lokální části.
  //    Lokální část je formálně case-sensitive, ale rozlišuje ji mizivé procento serverů
  //    a nerozlišování je jediné, co brání duplicitám. Vědomé rozhodnutí, viz 4.1.1.
  value = value.toLowerCase();

  // 6. Syntaktická kontrola.
  if (CONTROL.test(value) || WHITESPACE.test(value)) return { ok: false, code: 'invalid_email' };

  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) {
    return { ok: false, code: 'invalid_email' };
  }

  const local = value.slice(0, at);
  let domain = value.slice(at + 1);

  // 7. IDN doména na punycode. Lokální část zůstává v UTF-8, SMTPUTF8 řeší část 4.
  if (NON_ASCII.test(domain)) {
    const ascii = domainToASCII(domain);
    if (ascii === '') return { ok: false, code: 'invalid_email' };
    domain = ascii;
  }

  if (!domain.includes('.')) return { ok: false, code: 'invalid_email' };
  if (/^[-.]/.test(domain) || /[-.]$/.test(domain)) return { ok: false, code: 'invalid_email' };
  if (domain.includes('..')) return { ok: false, code: 'invalid_email' };
  if (local.length === 0) return { ok: false, code: 'invalid_email' };

  const email = `${local}@${domain}`;
  if (email.length > 254) return { ok: false, code: 'email_too_long' };
  if (email.length < 3) return { ok: false, code: 'invalid_email' };

  return displayName === undefined ? { ok: true, email } : { ok: true, email, displayName };
}

/** Doména adresy v malých písmenech. Předpokládá už normalizovanou adresu. */
export function emailDomain(email: string): string {
  return email.slice(email.indexOf('@') + 1);
}

let disposableDomains: ReadonlySet<string> = new Set();

/**
 * Načte volitelný seznam jednorázových domén (DISPOSABLE_DOMAINS_FILE) do paměti.
 * Volá se jednou při startu procesu, ne per požadavek.
 */
export function loadDisposableDomains(lines: readonly string[]): void {
  disposableDomains = new Set(
    lines
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

export function isDisposableDomain(email: string): boolean {
  if (disposableDomains.size === 0) return false;
  return disposableDomains.has(emailDomain(email.toLowerCase()));
}

/**
 * Maskovaná podoba pro veřejné stránky a pro seznam blokovaných adres: j***@example.cz
 * Používá se všude, kde by celá adresa byla zbytečná: odkaz na stránku předvoleb může
 * najít kdokoliv a seznam blokovaných adres je seznam lidí, kteří si komunikaci nepřáli.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
