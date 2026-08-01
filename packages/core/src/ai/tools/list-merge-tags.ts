/**
 * Nástroj `list_merge_tags`, kritérium 70.
 *
 * Model se smí dozvědět, JAKÁ pole projekt má. Nesmí se dozvědět, CO v nich
 * je. Proto tenhle soubor čte z katalogu polí (P07) výhradně definice, tedy
 * cestu, typ a popisek, a ukázkovou hodnotu si generuje sám z typu.
 *
 * Ukázková hodnota se ZÁMĚRNĚ nebere z žádného kontaktu, ani z ukázkového:
 * ukázkový kontakt v katalogu je pořád skutečný řádek z databáze projektu.
 * Kdo sem přidá `value: contact.email`, shodí test v no-contact-data.test.ts.
 */

export type MergeTagFieldInput = {
  /** P07 používá `path` ('first_name', 'attr.city'), starší volající `key`. */
  path?: string;
  key?: string;
  type: string;
  /** Buď prostý řetězec, nebo lokalizovaný záznam podle P07. */
  label: string | Record<string, string>;
  deleted?: boolean;
};

export type MergeTagCatalog = {
  fields: readonly MergeTagFieldInput[];
};

export type MergeTag = {
  path: string;
  type: string;
  label: string;
  /** Vygenerovaná ukázka podle typu, nikdy hodnota z databáze. */
  example: string;
};

/** Ukázky jsou zjevně vymyšlené, aby si je nikdo nespletl s daty projektu. */
const EXAMPLE_BY_TYPE: Record<string, string> = {
  string: 'ukázkový text',
  number: '42',
  boolean: 'ano',
  date: '2026-01-31',
  datetime: '2026-01-31 09:00',
  list: 'první položka, druhá položka',
};

function labelFor(label: string | Record<string, string>, language: string): string {
  if (typeof label === 'string') return label;
  return label[language] ?? label['en'] ?? Object.values(label)[0] ?? '';
}

function pathFor(field: MergeTagFieldInput): string {
  const raw = field.path ?? field.key ?? '';
  return raw.startsWith('contact.') ? raw : `contact.${raw}`;
}

export function listMergeTags(
  catalog: MergeTagCatalog,
  language = 'en',
): { tags: MergeTag[]; count: number } {
  const tags = catalog.fields
    .filter((field) => field.deleted !== true)
    .filter((field) => (field.path ?? field.key ?? '') !== '')
    .map((field) => ({
      path: pathFor(field),
      type: field.type,
      label: labelFor(field.label, language),
      example: EXAMPLE_BY_TYPE[field.type] ?? 'ukázková hodnota',
    }));
  return { tags, count: tags.length };
}
