import { vocative as libVocative } from 'czech-vocative';
import { normalizeNameKey } from './normalize';
import type { Confidence, Gender, GenderSource, NameOverrideLookup } from './types';

/** Jazyky, pro které se vokativ počítá. Pro ostatní se vrací nominativ. */
const VOCATIVE_LOCALES = new Set(['cs', 'sk']);

/** Znaky, které smí být ve jméně, aby se dal vokativ počítat s jistotou. */
const SAFE_NAME = /^[A-Za-zÀ-ɏ'\- ]+$/;

/** Koncovky, po kterých se mužské jméno legitimně nemění. */
const MALE_UNCHANGED_ENDINGS = ['í', 'ý', 'é', 'o', 'u', 'i'];

/** Koncovky, po kterých je jméno tvarově ženské bez ohledu na to, co říká sloupec rod. */
const FEMININE_ENDINGS = ['ová', 'ská', 'cká'];
const VOWELS = 'aeiouyáéíóúůýě';

/** Zdroje rodu, kterým se dá věřit natolik, že samy o sobě jistotu nesnižují. */
const TRUSTED_GENDER_SOURCES: readonly GenderSource[] = [
  'explicit',
  'workspace_override',
  'surname_rule',
  'given_name_dict',
  'manual',
];

export function localeHasVocative(locale: string): boolean {
  return VOCATIVE_LOCALES.has(locale.toLowerCase().split('-')[0] ?? '');
}

export type VocativeInput = {
  firstName: string | null;
  lastName: string | null;
  gender: Gender;
  genderSource?: GenderSource | undefined;
  locale: string;
  script: 'latin' | 'non_latin';
  overrides: NameOverrideLookup;
};

export type VocativeResult = {
  firstNameVocative: string | null;
  lastNameVocative: string | null;
  confidence: Confidence;
};

/** Tvarově ženské jméno: "ová", "ská", "cká" nebo "á" po souhlásce (Novotná, Tichá). */
function looksFeminine(value: string): boolean {
  const lower = value.toLowerCase();
  if (FEMININE_ENDINGS.some((e) => lower.endsWith(e))) return true;
  if (!lower.endsWith('á')) return false;
  const before = lower.slice(-2, -1);
  return before.length === 1 && !VOWELS.includes(before);
}

/**
 * Bezpečné volání knihovny. Vrací null, když vstup není použitelný.
 *
 * Ověřené chování czech-vocative 2.1.0, které tahle obálka musí ošetřit:
 * - netrimuje vstup: "  Jan  " vrátí "  Jan  e",
 * - neodmítá prázdný řetězec: "" vrátí "e",
 * - neodmítá číslice: "Jan123" vrátí "Jan123e",
 * - jednoznakový vstup: "X" vrátí "XI",
 * - víceslovný vstup nedělí: "Marie Anna" vrátí "Marie Anno",
 * - s vynuceným mužským rodem u ženského příjmení vyrobí nesmysl: "Nováková" plus
 *   womanBool = false dá "Novákováe".
 */
function callLibrary(value: string | null, gender: Gender, isLastName: boolean): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // NIKDY nevolat s vynuceným mužským rodem, když si rodem nejsme jistí.
  // Kombinace ženského příjmení a womanBool = false vyrobí zjevný nesmysl (Novákováe).
  // U neznámého rodu jde knihovna do automatického režimu, jehož nejhorší výsledek
  // je identita. Ženská větev je bezpečná (nejhůř se nic nezmění), mužská ne
  // (vždy se něco připojí).
  //
  // ODCHYLKA OD PLÁNU, VYNUCENÁ MĚŘENÍM: plán se vynucenému mužskému rodu vyhýbal jen
  // u rodu 'unknown' a proti "Novákováe" stavěl pojistku v deriveConfidence, která se
  // ale nikdy nespustí ("Novákováe" je o jediný znak delší než "Nováková", ne o čtyři).
  // Kritérium 23 to žádá pro všech dvanáct kombinací, takže se automatický režim volí
  // vždy, když je jméno tvarově ženské a rod říká něco jiného. Ověřeno spuštěním.
  if (gender === 'unknown' || (gender === 'male' && looksFeminine(trimmed))) {
    return isLastName ? libVocative(trimmed, undefined, true) : libVocative(trimmed);
  }
  return libVocative(trimmed, gender === 'female', isLastName);
}

/**
 * Spočítá vokativ křestního jména i příjmení a odvodí jistotu podle kapitoly 4.4.6 části 2.
 *
 * Vokativ se počítá PŘI ZÁPISU kontaktu, ne při odesílání kampaně. Je to výslovné
 * rozhodnutí z kapitoly 6.3 hlavní specifikace: sender nesmí sahat na tabulku kontaktů
 * a interpolace při odesílání musí být čisté dosazení hotové hodnoty. Cena je zanedbatelná,
 * změřeno 0,72 mikrosekundy na kontakt, tedy 3,6 sekundy procesorového času na pět milionů.
 */
export function computeVocative(input: VocativeInput): VocativeResult {
  // Jazyk bez vokativu: vrací se nominativ a oslovení funguje beze změny.
  if (!localeHasVocative(input.locale)) {
    return {
      firstNameVocative: input.firstName,
      lastNameVocative: input.lastName,
      confidence: 'high',
    };
  }

  // Nelatinkové písmo: česká morfologie na takové jméno nedává smysl.
  if (input.script === 'non_latin') {
    return { firstNameVocative: null, lastNameVocative: null, confidence: 'none' };
  }

  // Přepis projektu má přednost před výpočtem.
  const firstOverride =
    input.firstName === null
      ? undefined
      : input.overrides.find('first', normalizeNameKey(input.firstName))?.vocative;
  const lastOverride =
    input.lastName === null
      ? undefined
      : input.overrides.find('last', normalizeNameKey(input.lastName))?.vocative;

  if (firstOverride !== undefined || lastOverride !== undefined) {
    return {
      firstNameVocative: firstOverride ?? callLibrary(input.firstName, input.gender, false),
      lastNameVocative: lastOverride ?? callLibrary(input.lastName, input.gender, true),
      confidence: 'high',
    };
  }

  const firstNameVocative = callLibrary(input.firstName, input.gender, false);
  const lastNameVocative = callLibrary(input.lastName, input.gender, true);

  if (firstNameVocative === null && lastNameVocative === null) {
    return { firstNameVocative: null, lastNameVocative: null, confidence: 'none' };
  }

  return {
    firstNameVocative,
    lastNameVocative,
    confidence: deriveConfidence(input, firstNameVocative, lastNameVocative),
  };
}

/**
 * Jistota začíná na 'high' a snižuje se na 'low', jakmile platí kterákoliv podmínka
 * z tabulky ve 4.4.6. Každá podmínka odpovídá jednomu způsobu, jakým se dá příponová
 * tabulka knihovny splést, a všechny jsou pozorované, ne vymyšlené.
 */
function deriveConfidence(
  input: VocativeInput,
  firstNameVocative: string | null,
  lastNameVocative: string | null,
): Confidence {
  // Neznámý rod znamená, že se skloňovalo v automatickém režimu, tedy odhadem.
  // Bez tohohle by "Nikola Krátký" prošla jako jistý vokativ a v režimu strict
  // by šla ven s oslovením "Nikolo". Kritérium 20 žádá opak.
  if (input.gender === 'unknown') return 'low';

  const pairs: Array<[string | null, string | null]> = [
    [input.firstName, firstNameVocative],
    [input.lastName, lastNameVocative],
  ];

  for (const [source, result] of pairs) {
    if (source === null || result === null) continue;
    const trimmed = source.trim();

    // Číslice, emoji, cizí písmo.
    if (!SAFE_NAME.test(trimmed)) return 'low';
    // Příliš krátké nebo příliš dlouhé: "X" vrátí "XI".
    if (trimmed.length < 2 || trimmed.length > 40) return 'low';
    // Pojistka proti nabalování: výsledek o víc než tři znaky delší než vstup.
    if (result.length > trimmed.length + 3) return 'low';
    // Nezpracované víceslovné jméno.
    if (trimmed.includes(' ')) return 'low';
    // Příponová tabulka se netrefila: mužské jméno se nezměnilo, přestože nekončí
    // na koncovku, po které se legitimně nemění.
    if (
      result === trimmed &&
      input.gender === 'male' &&
      !MALE_UNCHANGED_ENDINGS.some((e) => trimmed.toLowerCase().endsWith(e))
    ) {
      return 'low';
    }
  }

  // Rod odvozený jinak než důvěryhodným pravidlem znamená nejistý vstup do výpočtu.
  if (input.genderSource !== undefined && !TRUSTED_GENDER_SOURCES.includes(input.genderSource)) {
    return 'low';
  }

  return 'high';
}
