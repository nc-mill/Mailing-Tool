import { resolveGender } from './gender';
import { buildGreeting } from './greeting';
import { detectScript, normalizeNameKey, normalizeNameValue } from './normalize';
import { splitFullName } from './split';
import { extractTitles } from './titles';
import type { Confidence, NameInput, NameOverrideLookup, NameResult, NameWarning } from './types';
import { computeVocative } from './vocative';

export type ResolveContext = {
  overrides: NameOverrideLookup;
  settings: {
    addressForm: 'formal' | 'informal';
    salutationBy: 'first_name' | 'surname';
    vocativePolicy: 'strict' | 'balanced';
  };
};

/**
 * Jediné veřejné rozhraní modulu oslovení. Čistá funkce: nesahá do databáze, jediný vstup
 * zvenčí jsou přepisy projektu předané v kontextu.
 *
 * Volá se PŘI KAŽDÉM ZÁPISU kontaktu, ze všech kanálů: API, formulář, příchozí webhook,
 * import. Nikdy při odesílání kampaně. Sender má hotové hodnoty ve sloupcích a na tabulku
 * kontaktů nesahá vůbec.
 */
export function resolveName(input: NameInput, ctx: ResolveContext): NameResult {
  const warnings: NameWarning[] = [];

  // 1. Normalizace vstupů.
  const fullName = normalizeNameValue(input.fullName);
  const givenFirst = normalizeNameValue(input.firstName);
  const givenLast = normalizeNameValue(input.lastName);
  const givenPrefix = normalizeNameValue(input.titlePrefix);
  const givenSuffix = normalizeNameValue(input.titleSuffix);
  warnings.push(...fullName.warnings, ...givenFirst.warnings, ...givenLast.warnings);

  // 2. Tituly a rozdělení. Samostatné sloupce se nedělí.
  let firstName = givenFirst.value;
  let lastName = givenLast.value;
  let middleName: string | null = null;
  let titlePrefix = givenPrefix.value;
  let titleSuffix = givenSuffix.value;
  let nameSplitConfidence: Confidence = 'high';
  let genderHint = input.gender;

  if (firstName === null && lastName === null && fullName.value !== null) {
    const titles = extractTitles(fullName.value);
    titlePrefix = titlePrefix ?? titles.titlePrefix;
    titleSuffix = titleSuffix ?? titles.titleSuffix;
    if (titles.genderHint !== undefined && (genderHint === undefined || genderHint === 'unknown')) {
      genderHint = titles.genderHint;
    }

    const split = splitFullName(titles.rest, input.nameOrder ?? 'auto');
    firstName = split.firstName;
    lastName = split.lastName;
    middleName = split.middleName;
    nameSplitConfidence = split.confidence;
    warnings.push(...split.warnings);
  } else if (firstName === null && lastName === null) {
    nameSplitConfidence = 'none';
  }

  // 3. Písmo. Nelatinkové jméno se uloží tak, jak přišlo, ale vokativ se nepočítá.
  const scriptSample = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  const script = scriptSample.length === 0 ? 'latin' : detectScript(scriptSample);
  if (script === 'non_latin') warnings.push('non_latin_script');

  // 4. Rod.
  const gender = resolveGender({
    firstName,
    lastName,
    explicit: genderHint === 'unknown' ? undefined : genderHint,
    overrides: ctx.overrides,
  });
  warnings.push(...gender.warnings);

  // 5. Vokativ.
  const vocative = computeVocative({
    firstName,
    lastName,
    gender: gender.gender,
    genderSource: gender.source,
    locale: input.locale,
    script,
    overrides: ctx.overrides,
  });
  if (vocative.confidence === 'low') warnings.push('vocative_low_confidence');

  // 6. Oslovení, obě varianty jedním průchodem.
  const greeting = buildGreeting({
    locale: input.locale,
    addressForm: ctx.settings.addressForm,
    salutationBy: ctx.settings.salutationBy,
    vocativePolicy: ctx.settings.vocativePolicy,
    firstName,
    lastName,
    gender: gender.gender,
    firstNameVocative: vocative.firstNameVocative,
    lastNameVocative: vocative.lastNameVocative,
    vocativeConfidence: vocative.confidence,
  });

  return {
    firstName,
    lastName,
    middleName,
    titlePrefix,
    titleSuffix,
    firstNameKey: firstName === null ? null : normalizeNameKey(firstName),
    lastNameKey: lastName === null ? null : normalizeNameKey(lastName),
    gender: gender.gender,
    genderSource: gender.source,
    firstNameVocative: vocative.firstNameVocative,
    lastNameVocative: vocative.lastNameVocative,
    vocativeConfidence: vocative.confidence,
    nameSplitConfidence,
    greeting: greeting.greeting,
    greetingNeutral: greeting.greetingNeutral,
    warnings: [...new Set(warnings)],
  };
}
