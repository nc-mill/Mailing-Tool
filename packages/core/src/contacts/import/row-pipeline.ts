import { normalizeEmail } from '../email';
import { resolveName } from '../naming/resolve';
import type { NameOverrideLookup } from '../naming/types';
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
  tags: string[];
  subscribe: boolean;
  consent: ImportOptions['consent'];
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
  const gender = at('gender');
  const locale = at('locale') ?? ctx.settings.locale;
  const name = resolveName(
    {
      ...(fullName === undefined ? {} : { fullName }),
      ...(firstName === undefined ? {} : { firstName }),
      ...(lastName === undefined ? {} : { lastName }),
      ...(titlePrefix === undefined ? {} : { titlePrefix }),
      ...(titleSuffix === undefined ? {} : { titleSuffix }),
      ...(gender === 'female' || gender === 'male' || gender === 'unknown' ? { gender } : {}),
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
  const tags: string[] = [...ctx.options.tag_ids];
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
    }
  }

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
    subscribe: suppressionReason === undefined,
    consent: suppressionReason === undefined ? ctx.options.consent : null,
    warnings: [...new Set(warnings)],
  };
}
