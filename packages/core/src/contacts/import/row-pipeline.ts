import { normalizeEmail } from '../email';
import { resolveName } from '../naming/resolve';
import type { Gender, NameOverrideLookup } from '../naming/types';
import type { ContactUpsertRow } from '../repo/contacts';
import { coerceFieldValue, type FieldSpec } from './coerce';
import type { ImportMapping } from './mapping';
import type { ImportOptions } from './options';
import type { RawRow } from './reader';

export type RowSettings = {
  locale: string;
  addressForm: 'formal' | 'informal';
  salutationBy: 'first_name' | 'surname';
  vocativePolicy: 'strict' | 'balanced';
};

export type RowContext = {
  mapping: ImportMapping;
  options: ImportOptions;
  fieldCatalog: Record<string, FieldSpec>;
  settings: RowSettings;
  overrides: NameOverrideLookup;
  /** e-mail v normalizovaném tvaru na důvod suppression. */
  suppressed: Map<string, string>;
};

export type ProcessedOkRow = {
  kind: 'ok';
  email: string;
  /**
   * Tvar odpovídá `ContactUpsertRow` z P07, tedy camelCase včetně `firstNameKey`
   * a `lastNameKey`. ODCHYLKA OD PLÁNU: plán měl v tomhle kroku snake_case klíče
   * (`first_name`), ale o dva úkoly dál je posílá do `upsertContacts`, které bere
   * camelCase. Se snake_case by se kontakt zapsal bez klíčů jmen a fronta
   * ke kontrole oslovení, která na částečném indexu nad nimi stojí, by po importu
   * zůstala prázdná. Jedna z těch dvou podob musela ustoupit a je to ta,
   * kterou nikdo dál nekonzumuje.
   */
  contact: ContactUpsertRow;
  attributes: Record<string, unknown>;
  /**
   * Štítky ze SLOUPCE souboru, tedy JMÉNA, ne identifikátory.
   *
   * Dřív se do stejného pole na začátku vysypaly i `options.tag_ids`, takže seznam byl
   * směs uuid a volného textu a nikdo z něj nedokázal poznat, co je co. Štítky z voleb
   * se proto berou z voleb, kde jsou, a zápis dávky je zakládá podle jména
   * (`ensureTagsIn`), stejně jako to dělá zápis kontaktu přes API, formulář a webhook.
   */
  tags: string[];
  /**
   * Seznamy z mapování sloupců (`{ target: 'list', list_id }`), tedy ty, o kterých
   * rozhoduje HODNOTA v řádku, ne volba pro celý soubor. Sčítají se s `options.list_ids`
   * až při zápisu dávky.
   */
  listIds: string[];
  subscribe: boolean;
  consent: ImportOptions['consent'];
  /**
   * Datum souhlasu ze sloupce `consent_occurred_at` v ISO tvaru, jinak `null`.
   * Import běžně nese historický souhlas ze staršího nástroje a datum je jeho podstatná
   * část: bez něj by se všem zapsalo „souhlasil dnes", což je nepravda v dokladu.
   */
  consentOccurredAt: string | null;
  warnings: string[];
  rowNumber: number;
};

export type ProcessedRow =
  | ProcessedOkRow
  | {
      kind: 'error';
      rowNumber: number;
      errorCode: string;
      column?: string;
      detail?: string;
      raw: string;
    }
  | { kind: 'suppressed'; rowNumber: number; reason: string };

const HARD_SUPPRESSION = new Set(['complaint', 'gdpr_erasure']);

/**
 * Hodnoty sloupce s pohlavím, kterým rozumíme.
 *
 * Dřív se do kontaktu propsalo jedině doslovné `male`, `female` nebo `unknown`,
 * protože se hodnota porovnávala rovnou s typem `Gender`. Český export ale píše
 * „muž" a „žena", zkratku „m" a „ž", případně „M"/"F", takže se sloupec, který
 * si uživatel v kroku Mapování výslovně nastavil jako Pohlaví, ve výsledku
 * ZAHODIL a rod se odhadoval ze jména. Ticho je tu ta nejhorší varianta: rod
 * řídí oslovení v 5. pádě, takže se špatný odhad projeví až v odeslané kampani.
 *
 * Porovnává se bez diakritiky a bez ohledu na velikost písmen, proto je „ž"
 * v tabulce zapsané jako „z". Co nepoznáme, vrací `undefined`, tedy „rozhodni
 * podle jména", ne „neznámý rod": neznámý rod by naopak odhad ze jména vypnul.
 */
const GENDER_VALUES: Record<string, Gender> = {
  m: 'male',
  muz: 'male',
  muzsky: 'male',
  male: 'male',
  man: 'male',
  pan: 'male',
  f: 'female',
  z: 'female',
  w: 'female',
  zena: 'female',
  zensky: 'female',
  female: 'female',
  woman: 'female',
  pani: 'female',
  unknown: 'unknown',
  neznamy: 'unknown',
  nezname: 'unknown',
};

export function parseGender(value: string | undefined): Gender | undefined {
  if (value === undefined) return undefined;
  const key = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  if (key === '') return undefined;
  return GENDER_VALUES[key];
}

/**
 * `normalizeEmail` vrací `invalid_email`, ale sloupec `import_errors.error_code`
 * má registrovanou hodnotu `email_invalid`. Překlad je tady, aby se do databáze
 * nedostal kód, který v registru není.
 */
const EMAIL_CODE: Record<string, string> = {
  invalid_email: 'email_invalid',
  email_too_long: 'email_too_long',
};

/**
 * Pořadí kroků je závazné. Kdyby se prohodilo, uživatel by u řádku bez e-mailu
 * dostal hlášku o špatném datu a nepochopil by, co má opravit.
 */
export function processRow(row: RawRow, ctx: RowContext): ProcessedRow {
  const warnings: string[] = [];

  // 2. Neshoda počtu polí.
  if (row.fieldCountMismatch) {
    return {
      kind: 'error',
      rowNumber: row.rowNumber,
      errorCode: 'row_field_count_mismatch',
      raw: row.raw,
    };
  }
  if (row.padded) warnings.push('trailing_fields_padded');
  if (row.truncatedCells > 0) warnings.push('value_truncated');

  // 3. Ořez bílých znaků.
  const cells = ctx.options.trim_whitespace ? row.fields.map((f) => f.trim()) : row.fields;

  const at = (target: string): string | undefined => {
    const index = Object.entries(ctx.mapping).find(([, m]) => m.target === target)?.[0];
    return index === undefined ? undefined : cells[Number(index)];
  };

  // 4. E-mail.
  const rawEmail = at('email') ?? '';
  if (rawEmail.length === 0) {
    return { kind: 'error', rowNumber: row.rowNumber, errorCode: 'email_missing', raw: row.raw };
  }
  const normalized = normalizeEmail(rawEmail);
  if (!normalized.ok) {
    return {
      kind: 'error',
      rowNumber: row.rowNumber,
      errorCode: EMAIL_CODE[normalized.code] ?? 'email_invalid',
      column: 'email',
      raw: row.raw,
    };
  }
  const email = normalized.email;

  // 6. Suppression list. Krok 5 (duplicity) řeší dedup.ts nad celou dávkou.
  const suppressionReason = ctx.suppressed.get(email);
  if (suppressionReason !== undefined && HARD_SUPPRESSION.has(suppressionReason)) {
    return { kind: 'suppressed', rowNumber: row.rowNumber, reason: suppressionReason };
  }
  if (suppressionReason !== undefined) warnings.push('suppressed_skipped');

  // 7. Jméno, rod, vokativ, oslovení. Jediné místo v importu, kde se to počítá.
  const fullName = ctx.options.split_full_name ? at('full_name') : undefined;
  const firstName = at('first_name');
  const lastName = at('last_name');
  const titlePrefix = at('title_prefix');
  const titleSuffix = at('title_suffix');
  const gender = parseGender(at('gender'));
  const locale = at('locale') ?? ctx.settings.locale;
  const name = resolveName(
    {
      ...(fullName === undefined ? {} : { fullName }),
      ...(firstName === undefined ? {} : { firstName }),
      ...(lastName === undefined ? {} : { lastName }),
      ...(titlePrefix === undefined ? {} : { titlePrefix }),
      ...(titleSuffix === undefined ? {} : { titleSuffix }),
      ...(gender === undefined ? {} : { gender }),
      nameOrder: ctx.options.name_order,
      locale,
    },
    {
      overrides: ctx.overrides,
      settings: {
        addressForm: ctx.settings.addressForm,
        salutationBy: ctx.settings.salutationBy,
        vocativePolicy: ctx.settings.vocativePolicy,
      },
    },
  );
  for (const warning of name.warnings) warnings.push(warning);

  // 8. Koerce vlastních polí. Chyba v jednom poli je chyba celého řádku,
  //    ne tichý zápis neúplného kontaktu.
  const attributes: Record<string, unknown> = {};
  const tags: string[] = [];
  const listIds: string[] = [];
  for (const [index, target] of Object.entries(ctx.mapping)) {
    const value = cells[Number(index)] ?? '';
    if (target.target === 'attribute') {
      const spec = ctx.fieldCatalog[target.key];
      if (spec === undefined) {
        return {
          kind: 'error',
          rowNumber: row.rowNumber,
          errorCode: 'unknown_field_key',
          column: target.key,
          raw: row.raw,
        };
      }
      const coerced = coerceFieldValue(value, spec, ctx.options);
      if (!coerced.ok) {
        return {
          kind: 'error',
          rowNumber: row.rowNumber,
          errorCode: coerced.code,
          column: target.key,
          detail: value,
          raw: row.raw,
        };
      }
      for (const w of coerced.warnings) warnings.push(w);
      if (coerced.value !== null || ctx.options.on_conflict === 'overwrite') {
        attributes[target.key] = coerced.value;
      }
    } else if (target.target === 'tag' && value.length > 0) {
      tags.push(
        ...value
          .split(/[,|]/)
          .map((t) => t.trim())
          .filter(Boolean),
      );
    } else if (target.target === 'list') {
      // Hodnota se čte jako ano/ne toutéž funkcí jako vlastní pole typu boolean,
      // takže „ano", „1" i „true" znamenají totéž a nesmysl skončí chybou řádku,
      // ne tichým nepřihlášením.
      if (value.length === 0) continue;
      const coerced = coerceFieldValue(value, { type: 'boolean' }, ctx.options);
      if (!coerced.ok) {
        return {
          kind: 'error',
          rowNumber: row.rowNumber,
          errorCode: coerced.code,
          column: 'list',
          detail: value,
          raw: row.raw,
        };
      }
      if (coerced.value === true) listIds.push(target.list_id);
    }
  }

  // 8b. Souhlas ze sloupců. Datum i zdroj jsou VOLITELNÉ upřesnění toho, co uživatel
  //     zadal ve volbách; bez volby `consent` se nezapisuje souhlas žádný, takže ani
  //     tyhle sloupce nemají co upřesňovat.
  const consentDateCell = at('consent_occurred_at') ?? '';
  let consentOccurredAt: string | null = null;
  if (consentDateCell.length > 0) {
    const coerced = coerceFieldValue(consentDateCell, { type: 'datetime' }, ctx.options);
    if (!coerced.ok) {
      return {
        kind: 'error',
        rowNumber: row.rowNumber,
        errorCode: coerced.code,
        column: 'consent_occurred_at',
        detail: consentDateCell,
        raw: row.raw,
      };
    }
    for (const w of coerced.warnings) warnings.push(w);
    consentOccurredAt = typeof coerced.value === 'string' ? coerced.value : null;
  }
  const consentSourceCell = at('consent_source') ?? '';
  const optionConsent = ctx.options.consent;
  const consent =
    optionConsent === null
      ? null
      : consentSourceCell.length > 0
        ? { ...optionConsent, source: consentSourceCell.slice(0, 120) }
        : optionConsent;

  // 9. Sestavení řádku do dávky.
  return {
    kind: 'ok',
    email,
    rowNumber: row.rowNumber,
    contact: {
      email,
      firstName: name.firstName,
      lastName: name.lastName,
      middleName: name.middleName,
      titlePrefix: name.titlePrefix,
      titleSuffix: name.titleSuffix,
      firstNameKey: name.firstNameKey,
      lastNameKey: name.lastNameKey,
      gender: name.gender,
      genderSource: name.genderSource,
      firstNameVocative: name.firstNameVocative,
      lastNameVocative: name.lastNameVocative,
      vocativeConfidence: name.vocativeConfidence,
      nameSplitConfidence: name.nameSplitConfidence,
      greeting: name.greeting,
      greetingNeutral: name.greetingNeutral,
      locale,
      attributes,
    },
    attributes,
    tags,
    // Měkce potlačená adresa nedostane přihlášení ani souhlas, ať už je v souboru
    // napsané cokoli: pravidlo 4 platí i pro seznamy ze sloupce.
    listIds: suppressionReason === undefined ? listIds : [],
    subscribe: suppressionReason === undefined,
    consent: suppressionReason === undefined ? consent : null,
    consentOccurredAt,
    warnings: [...new Set(warnings)],
  };
}
