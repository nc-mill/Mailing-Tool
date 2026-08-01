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

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const target = HEADER_DICTIONARY[normalizeHeader(header)];
    // "jmeno" je ve slovníku jako first_name a zároveň součást "jmeno a prijmeni";
    // delší shoda vyhrává, protože normalizeHeader porovnává celý řetězec.
    if (target !== undefined && !used.has(target)) {
      used.add(target);
      mapping[String(index)] = { target };
    } else {
      mapping[String(index)] = { target: 'ignore' };
    }
  });
  return mapping;
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
  const warnings: string[] = [];
  // Samostatná pole vyhrávají nad full_name, a uživatel se to musí dozvědět v náhledu.
  if (
    targets.includes('full_name') &&
    (targets.includes('first_name') || targets.includes('last_name'))
  ) {
    warnings.push('full_name_ignored');
  }
  return { warnings };
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
