export type Gender = 'female' | 'male' | 'unknown';

export type GenderSource =
  | 'explicit'
  | 'workspace_override'
  | 'surname_rule'
  | 'surname_rule_translit'
  | 'given_name_dict'
  | 'library_heuristic'
  | 'manual'
  | 'none';

export type Confidence = 'high' | 'low' | 'none';

export type NameWarning =
  | 'name_split_low_confidence'
  | 'gender_unknown'
  | 'vocative_low_confidence'
  | 'gender_conflict'
  | 'non_latin_script'
  | 'vietnamese_order_assumed'
  | 'value_truncated'
  | 'name_empty';

export type NameInput = {
  /** Jeden sloupec se jménem. Rozdělí se podle 4.4.3. */
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  titlePrefix?: string | null;
  titleSuffix?: string | null;
  /** Explicitní hodnota ze zdroje. Má nejvyšší prioritu v určení rodu. */
  gender?: Gender;
  nameOrder?: 'auto' | 'first_last' | 'last_first';
  /** Jazyk kontaktu. Vokativ se počítá jen pro 'cs' a 'sk'. */
  locale: string;
};

export type NameResult = {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  titlePrefix: string | null;
  titleSuffix: string | null;
  /** Kanonický klíč křestního jména, plní se do contacts.first_name_key. */
  firstNameKey: string | null;
  /** Kanonický klíč příjmení, plní se do contacts.last_name_key. */
  lastNameKey: string | null;
  gender: Gender;
  genderSource: GenderSource;
  firstNameVocative: string | null;
  lastNameVocative: string | null;
  vocativeConfidence: Confidence;
  nameSplitConfidence: Confidence;
  /** Hotové oslovení, ukládá se do contacts.greeting. */
  greeting: string;
  /** Oslovení bez jména, ukládá se do contacts.greeting_neutral. */
  greetingNeutral: string;
  warnings: NameWarning[];
};

/** Vyhledání přepisu na úrovni projektu. Jediné místo, kde modul sahá mimo sebe. */
export type NameOverrideLookup = {
  find(kind: 'first' | 'last', nameKey: string): { gender?: Gender; vocative?: string } | undefined;
};

/** Prázdný lookup pro případy, kdy projekt žádné přepisy nemá. */
export const EMPTY_OVERRIDES: NameOverrideLookup = { find: () => undefined };
