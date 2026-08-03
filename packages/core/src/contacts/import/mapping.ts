import { z } from 'zod';
import { invalidImport } from './errors';

export const MAPPING_TARGETS = [
  'email',
  'first_name',
  'last_name',
  'full_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'locale',
  'timezone',
  'consent_occurred_at',
  'consent_source',
  'ignore',
] as const;

export type MappingTarget = (typeof MAPPING_TARGETS)[number];

export const ImportMappingSchema = z.record(
  z.string().regex(/^\d+$/),
  z.union([
    z.object({ target: z.enum(MAPPING_TARGETS) }).strict(),
    z.object({ target: z.literal('attribute'), key: z.string().min(1).max(64) }).strict(),
    z.object({ target: z.literal('tag') }).strict(),
    z.object({ target: z.literal('list'), list_id: z.uuid() }).strict(),
  ]),
);

export type ImportMapping = z.infer<typeof ImportMappingSchema>;

/** Porovnává se bez diakritiky a bez ohledu na velikost písmen. */
function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_DICTIONARY: Record<string, MappingTarget> = {};
const DICTIONARY_SOURCE: [MappingTarget, string[]][] = [
  [
    'email',
    ['email', 'e-mail', 'mail', 'emailova adresa', 'e-mailova adresa', 'email address', 'address'],
  ],
  ['first_name', ['jmeno', 'krestni', 'krestni jmeno', 'first name', 'given name', 'firstname']],
  ['last_name', ['prijmeni', 'last name', 'surname', 'family name', 'lastname']],
  ['full_name', ['jmeno a prijmeni', 'cele jmeno', 'name', 'full name', 'nazev']],
  ['gender', ['pohlavi', 'rod', 'gender', 'sex', 'osloveni']],
  ['title_prefix', ['titul', 'titul pred', 'title']],
  ['locale', ['jazyk', 'language', 'locale', 'jazyk komunikace']],
];
for (const [target, headers] of DICTIONARY_SOURCE) {
  for (const h of headers) HEADER_DICTIONARY[h] = target;
}

/** Kolik ukázkových hodnot se prohlíží, než se sloupec prohlásí za celé jméno. */
const NAME_SAMPLE_LIMIT = 50;

/** Slovo je posloupnost neprázdných znaků; čárka odděluje stejně jako mezera („Nováková, Jana"). */
function wordCount(value: string): number {
  return value
    .replace(/^"|"$/g, '')
    .replaceAll(',', ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

/**
 * Nesou hodnoty sloupce CELÉ jméno, ne jen křestní?
 *
 * Rozhoduje se podle DAT, ne podle názvu sloupce, a je to nutné: český export
 * má nad sloupcem „Jméno" jednou „Jana" a podruhé „Jana Nováková". Název je
 * v obou případech stejný, takže z něj to poznat nejde. Poznat to jde z hodnot,
 * protože křestní jméno mezeru nemá, kdežto „Jana Nováková" i „Ing. Petr
 * Svoboda" ano.
 *
 * PRÁH JE POLOVINA, NE VĚTŠINA, a je to schválně. Obě chyby nestojí stejně:
 *   - celé jméno omylem v `first_name` sebere příjmení, rod i vokativ a příjemce
 *     dostane neutrální „Dobrý den" místo „Dobrý den, Jano". Nevratné.
 *   - křestní jméno omylem ve `full_name` neudělá nic: `splitFullName()` na
 *     jednom tokenu vrátí známé křestní jméno zpátky do `firstName` s vysokou
 *     jistotou.
 * Když je poměr půl na půl, vyhrává tedy `full_name`, protože je to ta strana,
 * ze které se dá vrátit.
 */
function looksLikeFullName(values: string[]): boolean {
  const sample = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, NAME_SAMPLE_LIMIT);
  if (sample.length === 0) return false;
  const multiword = sample.filter((value) => wordCount(value) > 1).length;
  return multiword * 2 >= sample.length;
}

/**
 * Návrh mapování sloupců.
 *
 * `sampleRows` jsou DATOVÉ řádky ze začátku souboru ve stejném pořadí sloupců
 * jako `headers`. Bez nich se rozhoduje jen podle názvu sloupce, což u českého
 * „Jméno" nestačí; viz `looksLikeFullName`.
 */
export function suggestMapping(headers: string[], sampleRows: string[][] = []): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  // "jmeno" je ve slovníku jako first_name a zároveň součást "jmeno a prijmeni";
  // delší shoda vyhrává, protože normalizeHeader porovnává celý řetězec.
  const byHeader = headers.map((header) => HEADER_DICTIONARY[normalizeHeader(header)]);

  /**
   * Povýšení na `full_name` se dělá jen tehdy, když soubor nemá vlastní sloupec
   * s příjmením ani s celým jménem. Jinak by návrh sám vyrobil dvojici, kterou
   * `assertMappingValid` označí `full_name_ignored`, tedy mapování, které se
   * tiše neprojeví.
   */
  const hasOwnNameColumns = byHeader.includes('last_name') || byHeader.includes('full_name');

  headers.forEach((header, index) => {
    let target = byHeader[index];
    if (target === 'first_name' && !hasOwnNameColumns) {
      const values = sampleRows.map((row) => row[index] ?? '');
      if (looksLikeFullName(values)) target = 'full_name';
    }
    if (target !== undefined && !used.has(target)) {
      used.add(target);
      mapping[String(index)] = { target };
    } else {
      mapping[String(index)] = { target: 'ignore' };
    }
  });
  return mapping;
}

/**
 * Varování k mapování, BEZ vyhazování výjimky.
 *
 * Náhled je potřebuje i u mapování, které ještě nemá sloupec s e-mailem,
 * protože krok Mapování je ten, kde se e-mail teprve vybírá. `assertMappingValid`
 * by v tu chvíli spadla na `no_email_column_mapped` a náhled by místo varování
 * vrátil pětistovku.
 */
export function collectMappingWarnings(mapping: unknown): string[] {
  const parsed = ImportMappingSchema.safeParse(mapping);
  if (!parsed.success) return [];
  return warningsFor(Object.values(parsed.data).map((m) => m.target));
}

/** Samostatná pole vyhrávají nad full_name, a uživatel se to musí dozvědět v náhledu. */
function warningsFor(targets: string[]): string[] {
  const warnings: string[] = [];
  if (
    targets.includes('full_name') &&
    (targets.includes('first_name') || targets.includes('last_name'))
  ) {
    warnings.push('full_name_ignored');
  }
  return warnings;
}

export function assertMappingValid(mapping: unknown): { warnings: string[] } {
  const parsed = ImportMappingSchema.parse(mapping);
  const targets = Object.values(parsed).map((m) => m.target);
  const emailCount = targets.filter((t) => t === 'email').length;
  if (emailCount === 0) {
    invalidImport('mapping', 'no_email_column_mapped', 'Exactly one column must map to email.');
  }
  const singleUse = targets.filter(
    (t) => t !== 'ignore' && t !== 'attribute' && t !== 'tag' && t !== 'list',
  );
  const duplicates = singleUse.filter((t, i) => singleUse.indexOf(t) !== i);
  if (duplicates.length > 0) {
    invalidImport('mapping', 'duplicate_target', 'A target column is mapped more than once.', {
      targets: [...new Set(duplicates)],
    });
  }
  return { warnings: warningsFor(targets) };
}

export type GuessedType = 'number' | 'boolean' | 'enum' | 'text';

export function guessFieldType(values: string[]): GuessedType {
  const sample = values.filter((v) => v.trim().length > 0).slice(0, 100);
  if (sample.length === 0) return 'text';
  if (sample.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return 'number';
  const booleans = new Set(['ano', 'ne', 'true', 'false', 'yes', 'no', '1', '0']);
  if (sample.every((v) => booleans.has(v.trim().toLowerCase()))) return 'boolean';
  const distinct = new Set(sample.map((v) => v.trim()));
  if (distinct.size < 20 && sample.every((v) => v.trim().length <= 40)) return 'enum';
  return 'text';
}
