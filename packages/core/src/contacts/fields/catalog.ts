import { createHash } from 'node:crypto';
import type { WorkspaceContext } from '../../identity/types';
import { listContactFields } from '../repo/contact-fields';
import { isGreetingEnabled } from '../settings';
import type { FieldType } from './coerce';

/** Popisek v libovolném počtu jazyků. Klíč je jazykový tag, en je povinný jako záchyt. */
export type LocalizedText = Record<string, string> & { en: string };

export type FieldCatalogType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'list';

export type FieldCatalogGroup = 'identity' | 'name' | 'salutation' | 'custom' | 'meta';

export type FieldCatalogEntry = {
  /** 'first_name' | 'attr.city' | 'greeting' */
  path: string;
  type: FieldCatalogType;
  label: LocalizedText;
  group: FieldCatalogGroup;
  /** Jen u typu 'list': typ položky. */
  itemType?: FieldCatalogType;
  /** true u archivovaného pole. Šablona ho smí mít, ale editor ho nenabízí. */
  deleted: boolean;
};

export type FieldCatalog = {
  fields: FieldCatalogEntry[];
  /** Hash katalogu kvůli invalidaci cache v části 3. */
  version: string;
};

/**
 * KATALOG SE VYZVEDÁVÁ IMPORTEM V PROCESU, NE PŘES REST.
 *
 * Kompilace šablony i validace merge tagů běží uvnitř téhož procesu, takže HTTP volání
 * by přidalo síťový skok a druhý zdroj pravdy do cesty, která musí být deterministická.
 *
 * Importuje se z **`@mlain/core/contacts`**, tedy z veřejné plochy domény. Hluboká
 * podcesta `@mlain/core/contacts/fields/catalog` NEFUNGUJE: zástupný znak v mapě
 * `exports` balíčku `@mlain/core` pohlcuje i lomítka, takže se rozřeší na
 * `src/contacts/fields/catalog/index.ts`, tedy na adresář, který neexistuje.
 *
 * Typ nabývá hodnot 'string', 'number', 'boolean', 'date', 'datetime', 'list',
 * tedy **'string', ne 'text'**. Hodnota 'text' je vstupní typ vlastního pole
 * (contact_fields.type) a mapuje se přes TYPE_MAP níž. Jsou to dvě různé soustavy
 * schválně: uživatel rozlišuje krátký a dlouhý text, šablona ne.
 */

/** Mapování naší typové soustavy na typy, které konzumuje část 3. */
const TYPE_MAP: Record<FieldType, { type: FieldCatalogType; itemType?: FieldCatalogType }> = {
  text: { type: 'string' },
  long_text: { type: 'string' },
  url: { type: 'string' },
  email: { type: 'string' },
  phone: { type: 'string' },
  enum: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  date: { type: 'date' },
  datetime: { type: 'datetime' },
  multi_enum: { type: 'list', itemType: 'string' },
};

/**
 * Prvotřídní pole kontaktu. Katalog je obsahuje SPOLU s vlastními poli, protože jinak
 * by část 3 musela mít druhý, ručně udržovaný seznam, který by se časem rozešel.
 *
 * Interní údaje (status, source, vocative_confidence, processing_restricted,
 * email_fingerprints, sloupce s _at kromě created_at) tam záměrně NEJSOU: nemají co
 * dělat v těle e-mailu.
 */
const FIRST_CLASS_FIELDS: readonly Omit<FieldCatalogEntry, 'deleted'>[] = [
  { path: 'email', type: 'string', label: { en: 'Email', cs: 'E-mail' }, group: 'identity' },
  {
    path: 'first_name',
    type: 'string',
    label: { en: 'First name', cs: 'Křestní jméno' },
    group: 'name',
  },
  { path: 'last_name', type: 'string', label: { en: 'Last name', cs: 'Příjmení' }, group: 'name' },
  {
    path: 'middle_name',
    type: 'string',
    label: { en: 'Middle name', cs: 'Prostřední jméno' },
    group: 'name',
  },
  {
    path: 'title_prefix',
    type: 'string',
    label: { en: 'Title before name', cs: 'Titul před jménem' },
    group: 'name',
  },
  {
    path: 'title_suffix',
    type: 'string',
    label: { en: 'Title after name', cs: 'Titul za jménem' },
    group: 'name',
  },
  { path: 'gender', type: 'string', label: { en: 'Gender', cs: 'Rod' }, group: 'salutation' },
  {
    path: 'first_name_vocative',
    type: 'string',
    label: { en: 'First name, vocative', cs: 'Křestní jméno v 5. pádu' },
    group: 'salutation',
  },
  {
    path: 'last_name_vocative',
    type: 'string',
    label: { en: 'Last name, vocative', cs: 'Příjmení v 5. pádu' },
    group: 'salutation',
  },
  {
    path: 'greeting',
    type: 'string',
    label: { en: 'Greeting', cs: 'Oslovení' },
    group: 'salutation',
  },
  { path: 'locale', type: 'string', label: { en: 'Language', cs: 'Jazyk' }, group: 'meta' },
  {
    path: 'created_at',
    type: 'datetime',
    label: { en: 'Created', cs: 'Vytvořeno' },
    group: 'meta',
  },
];

/**
 * Pole, která zmizí, když projekt oslovení a 5. pád neřeší
 * (`workspaces.greeting_enabled = false`).
 *
 * `gender` mezi nimi ZÁMĚRNĚ NENÍ. Rod není 5. pád ani oslovení, je to údaj
 * o člověku, dá se mapovat při importu a filtrovat v segmentech i tam, kde se
 * nikdo neoslovuje.
 */
const SALUTATION_FIELD_PATHS = new Set(['first_name_vocative', 'last_name_vocative', 'greeting']);

/**
 * Jediný zdroj pravdy o tom, jaká pole v projektu existují. Konzumuje ho validátor
 * merge tagů a nabídka polí v editoru šablon (část 3), a to uvnitř procesu, ne přes REST.
 */
export async function getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog> {
  const [custom, greetingEnabled] = await Promise.all([
    listContactFields(ctx, { includeArchived: true }),
    isGreetingEnabled(ctx),
  ]);

  const fields: FieldCatalogEntry[] = [
    ...FIRST_CLASS_FIELDS.map((field) => ({
      ...field,
      // NEODSTRAŇUJE SE, JEN SE OZNAČÍ. Je v tom celý rozdíl mezi „editor to
      // nenabízí" a „kampaň nejde odeslat".
      //
      // Katalog totiž nekrmí jenom nabídku personalizace. Přes `toLiquidRoots`
      // (`packages/emails/src/paths.ts`) z něj vzniká seznam povolených cest pro
      // Liquid validátor, a ten na neznámé pole hlásí `liquid_unknown_field`
      // se závažností **error**. `compileTemplate` na chybě vrátí `ok: false`,
      // takže by šablona, ve které `{{ contact.greeting }}` už stojí, přestala
      // jít odeslat, a to jen proto, že někdo přepnul volbu v nastavení.
      //
      // `toLiquidRoots` příznak `deleted` ignoruje, kdežto `usableFields`
      // v editoru podle něj filtruje. Přesně tenhle rozdíl je tu potřeba:
      // nová značka se nevloží, existující dál renderuje správnou větu,
      // protože sloupec `contacts.greeting` se počítá dál.
      deleted: !greetingEnabled && SALUTATION_FIELD_PATHS.has(field.path),
    })),
    ...custom.map((field) => {
      const mapped = TYPE_MAP[field.type];
      return {
        path: `attr.${field.key}`,
        type: mapped.type,
        ...(mapped.itemType === undefined ? {} : { itemType: mapped.itemType }),
        // Když v label chybí jazyk uživatele, padá se na en; když chybí i ten, na key.
        label: { en: field.key, ...field.label } as LocalizedText,
        group: 'custom' as const,
        deleted: field.archivedAt !== null,
      };
    }),
  ];

  const canonical = JSON.stringify(
    fields.map((f) => [f.path, f.type, f.itemType ?? '', f.deleted]),
  );
  return { fields, version: createHash('sha256').update(canonical).digest('hex').slice(0, 16) };
}
