import { isWoman } from 'czech-vocative';
import { lookupGivenName } from './dictionary';
import { normalizeNameKey } from './normalize';
import type { Confidence, Gender, GenderSource, NameOverrideLookup, NameWarning } from './types';

const FEMININE_STRONG = ['ová', 'ská', 'cká', 'žská'];
const FEMININE_TRANSLIT = ['ova', 'eva', 'ska', 'cka', 'aya'];
const VOWELS = 'aeiouyáéíóúůýě';

export type GenderInput = {
  firstName: string | null;
  lastName: string | null;
  /** Hodnota ze zdroje nebo z oslovení pan či paní. */
  explicit?: Gender | undefined;
  overrides: NameOverrideLookup;
};

export type GenderResult = {
  gender: Gender;
  source: GenderSource;
  confidence: Confidence;
  warnings: NameWarning[];
};

function endsWithAny(value: string, endings: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return endings.some((e) => lower.endsWith(e));
}

/** Adjektivní ženské příjmení: "á" po souhlásce (Novotná, Malá, Tichá). */
function isAdjectivalFeminine(value: string): boolean {
  const lower = value.toLowerCase();
  if (!lower.endsWith('á')) return false;
  const before = lower.slice(-2, -1);
  return before.length === 1 && !VOWELS.includes(before);
}

/** Rod odvozený jen z příjmení, bez heuristiky knihovny. */
function genderFromSurname(
  lastName: string | null,
): { gender: Gender; source: GenderSource; confidence: Confidence } | undefined {
  if (lastName === null) return undefined;
  if (endsWithAny(lastName, FEMININE_STRONG) || isAdjectivalFeminine(lastName)) {
    return { gender: 'female', source: 'surname_rule', confidence: 'high' };
  }
  if (endsWithAny(lastName, FEMININE_TRANSLIT)) {
    return { gender: 'female', source: 'surname_rule_translit', confidence: 'low' };
  }
  return undefined;
}

/**
 * Určí rod podle prioritní tabulky z kapitoly 4.4.4 části 2. První pravidlo,
 * které vrátí výsledek, vyhrává.
 *
 * Konflikt mezi pravidly podle příjmení (3, 4) a podle křestního jména (5) vede na
 * gender 'unknown' s varováním gender_conflict a kontakt jde do fronty ke kontrole.
 * Je to typicky příznak prohozených sloupců v importovaném souboru, tedy cenná informace,
 * ne šum. Explicitní hodnota a přepis projektu konflikt přebíjejí, protože je zadal člověk.
 *
 * Obourodé jméno konflikt nevyvolá: samo o sobě netvrdí nic, takže se s příjmením
 * nemá o co přít.
 *
 * Původ ani etnicitu podle jména neurčujeme, je to výslovné rozhodnutí zadavatele.
 */
export function resolveGender(input: GenderInput): GenderResult {
  const warnings: NameWarning[] = [];

  // 1. Explicitní hodnota ze zdroje.
  if (input.explicit === 'female' || input.explicit === 'male') {
    return { gender: input.explicit, source: 'explicit', confidence: 'high', warnings };
  }

  // 2. Přepis na úrovni projektu, nejdřív křestní jméno, pak příjmení.
  for (const [kind, value] of [
    ['first', input.firstName],
    ['last', input.lastName],
  ] as const) {
    if (value === null) continue;
    const override = input.overrides.find(kind, normalizeNameKey(value))?.gender;
    if (override === 'female' || override === 'male') {
      return { gender: override, source: 'workspace_override', confidence: 'high', warnings };
    }
  }

  const bySurname = genderFromSurname(input.lastName);
  const byGivenName = input.firstName === null ? undefined : lookupGivenName(input.firstName);

  // Konflikt: příjmení říká jedno, slovník křestních jmen druhé.
  if (
    bySurname !== undefined &&
    byGivenName !== undefined &&
    byGivenName.gender !== 'unknown' &&
    !byGivenName.ambiguous &&
    byGivenName.gender !== bySurname.gender
  ) {
    warnings.push('gender_conflict');
    return { gender: 'unknown', source: 'none', confidence: 'low', warnings };
  }

  // 3. a 4. Pravidla podle příjmení.
  if (bySurname !== undefined) return { ...bySurname, warnings };

  // 6. Obourodé jméno ze slovníku.
  //
  // ODCHYLKA OD PLÁNU: plán u obourodého jména vracel rod z datového souboru
  // (u "Nikola" tedy 'female') jen se sníženou jistotou. Kritérium 20 ale žádá,
  // aby "Nikola Krátký" skončila s rodem 'unknown'. Obourodé jméno o rodu nic netvrdí,
  // tak ho ani netvrdíme; příznak ambiguous je v datech právě proto, aby se rod
  // odvozovat nedal. Datový soubor zůstal beze změny.
  if (byGivenName !== undefined && byGivenName.ambiguous) {
    warnings.push('gender_unknown');
    return { gender: 'unknown', source: 'given_name_dict', confidence: 'low', warnings };
  }

  // 5. Jednoznačné jméno ze slovníku.
  if (byGivenName !== undefined && byGivenName.gender !== 'unknown') {
    return {
      gender: byGivenName.gender,
      source: 'given_name_dict',
      confidence: 'high',
      warnings,
    };
  }
  if (byGivenName !== undefined) {
    // Ve slovníku je, ale s rodem 'u'. Víme, že je sporné, a víc nezjistíme.
    warnings.push('gender_unknown');
    return { gender: 'unknown', source: 'given_name_dict', confidence: 'low', warnings };
  }

  // 7. Heuristika knihovny. Je čistě příponová a na neceských jménech vrací v podstatě
  //    náhodu ("Zhang" vrátí true, "Kim" false), proto je až sedmá v pořadí a vždy
  //    vede na jistotu 'low'.
  const heuristicSource = input.firstName ?? input.lastName;
  if (heuristicSource !== null && heuristicSource.trim().length >= 2) {
    return {
      gender: isWoman(heuristicSource.trim()) ? 'female' : 'male',
      source: 'library_heuristic',
      confidence: 'low',
      warnings,
    };
  }

  // 8. Nic z toho.
  warnings.push('gender_unknown');
  return { gender: 'unknown', source: 'none', confidence: 'none', warnings };
}
