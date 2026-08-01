import { ApiError, validationFailed } from '../../errors/api-error';

export const CONTACT_FIELD_LIMIT = 100;
export const CONTACT_INDEXED_FIELD_LIMIT = 8;
export const FIELD_KEY_MAX_LENGTH = 40;
export const TEXT_MAX_LENGTH = 1000;
export const LONG_TEXT_MAX_LENGTH = 10000;
export const ENUM_MAX_VALUES = 200;
export const MULTI_ENUM_MAX_ITEMS = 50;
export const URL_MAX_LENGTH = 2000;

/**
 * Strop velikosti attributes na kontakt, konfigurovatelný přes CONTACT_ATTRIBUTES_MAX_BYTES.
 *
 * Vynucuje ho APLIKACE, ne CHECK v databázi, a měří se SERIALIZOVANÁ DÉLKA v UTF-8.
 * Původní CHECK (pg_column_size(attributes) <= 65536) byl zrušený ze dvou důvodů:
 *
 * 1. Odporoval vlastním limitům. Sto polí a long_text do 10 000 znaků znamená, že už
 *    sedm plných long_text polí přeteče 64 kB, přestože každé z nich je povolené.
 * 2. pg_column_size měří velikost PO TOAST kompresi. Dva kontakty se stejně dlouhými
 *    daty tak dopadnou různě podle toho, jak dobře se jejich text komprimuje: opakující
 *    se text projde, náhodný identifikátor stejné délky ne. Chyba, která u jednoho řádku
 *    nastane a u druhého ne, se nedá vysvětlit ani reprodukovat.
 *
 * CHECK v databázi zůstává jako pojistka s velkou rezervou (4 MiB), takže se aplikační
 * limit uplatní vždycky dřív a databázová chyba znamená chybu v kódu, ne chybu uživatele.
 */
export const CONTACT_ATTRIBUTES_MAX_BYTES = 262144;

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Klíče, které nelze použít pro vlastní pole. Jsou to prvotřídní pole kontaktu
 * a hodnoty dosazované při odesílání. Vlastní pole se adresují výhradně přes prefix
 * attr ({{ contact.attr.city }}), takže kolize by nerozbila šablonu, ale zmátla by
 * uživatele i katalog polí.
 */
export const RESERVED_FIELD_KEYS: readonly string[] = [
  'email',
  'first_name',
  'last_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'greeting',
  'locale',
  'status',
  'id',
  'created_at',
  'updated_at',
  'tags',
  'lists',
  'unsubscribe_url',
  'webview_url',
  'first_name_vocative',
  'last_name_vocative',
];

export function assertFieldKeyAllowed(key: string): void {
  if (!FIELD_KEY_PATTERN.test(key)) {
    // Tvar { path, code, message } je zmrazený kontrakt pole `errors` z P04, 4.2.
    // Text se do odpovědi nikdy nedostane z tohohle místa: skládá ho vrstva HTTP
    // z katalogu podle Accept-Language. Slouží jen logu a testu.
    throw validationFailed([
      { path: 'key', code: 'unknown_field_key', message: 'field key has an invalid shape' },
    ]);
  }
  if (RESERVED_FIELD_KEYS.includes(key)) {
    throw validationFailed([
      { path: 'key', code: 'field_key_reserved', message: 'field key is reserved' },
    ]);
  }
}

/**
 * Kontrola velikosti attributes před zápisem. Deterministická, spočitatelná dopředu
 * a dá se o ní napsat srozumitelná chyba se skutečnou i povolenou velikostí.
 */
export function assertAttributesSize(
  attributes: Record<string, unknown>,
  limitBytes: number = CONTACT_ATTRIBUTES_MAX_BYTES,
): void {
  const actual = Buffer.byteLength(JSON.stringify(attributes), 'utf8');
  if (actual > limitBytes) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'attributes',
          code: 'attributes_too_large',
          message: 'attributes payload is too large',
        },
      ],
      params: { actual_bytes: actual, limit_bytes: limitBytes },
    });
  }
}
