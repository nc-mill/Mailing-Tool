import titlesData from './data/titles.json' with { type: 'json' };
import { normalizeNameKey } from './normalize';
import type { Gender } from './types';

const PREFIX_TITLES = new Set<string>(titlesData.prefix);
const SUFFIX_TITLES = new Set<string>(titlesData.suffix);
const HONORIFICS = titlesData.honorific as Record<string, Gender>;
const CONJUNCTIONS = new Set(['et', '&']);

export type TitleExtraction = {
  titlePrefix: string | null;
  titleSuffix: string | null;
  /** Jméno bez titulů. Když by po odebrání nic nezbylo, vrací se původní hodnota. */
  rest: string;
  /** Rod odvozený z oslovení pan nebo paní. Do title_prefix se neukládá. */
  genderHint?: Gender | undefined;
};

/** Token se porovnává po odstranění koncové tečky a po kanonizaci. */
function tokenKey(token: string): string {
  return normalizeNameKey(token.replace(/\.$/, ''));
}

/**
 * Oddělí akademické tituly podle kapitoly 4.4.2 části 2.
 *
 * Pravidla, na kterých záleží:
 * - Prefixy se sbírají od začátku, dokud token odpovídá slovníku. Vícedílné prefixy
 *   (Ing. arch., MUDr. et MUDr.) tak vzniknou přirozeně.
 * - Všechno za první čárkou jsou sufixové tituly, ALE jen když to do slovníku sedí.
 *   Když ne, je čárka signálem obráceného pořadí (Nováková, Jana) a hodnota se nechá celá.
 * - Původní tvar včetně teček a velikosti písmen se zachovává tak, jak byl v souboru.
 * - Oslovení pan a paní se odstraní a použije jako signál rodu, ale neuloží se.
 */
export function extractTitles(raw: string): TitleExtraction {
  const value = raw.trim();
  if (value.length === 0) {
    return { titlePrefix: null, titleSuffix: null, rest: value, genderHint: undefined };
  }

  let working = value;
  let titleSuffix: string | null = null;

  // Sufixy za první čárkou.
  const commaAt = working.indexOf(',');
  if (commaAt >= 0) {
    const after = working.slice(commaAt + 1).trim();
    const parts = after
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const allAreTitles = parts.length > 0 && parts.every((p) => SUFFIX_TITLES.has(tokenKey(p)));
    if (allAreTitles) {
      titleSuffix = after;
      working = working.slice(0, commaAt).trim();
    }
  }

  let tokens = working.split(' ').filter((t) => t.length > 0);

  // Oslovení na začátku: pan, paní, p. Odstraní se a použije jako signál rodu.
  let genderHint: Gender | undefined;
  if (tokens.length > 1) {
    const hint = HONORIFICS[tokenKey(tokens[0] ?? '')];
    if (hint !== undefined) {
      genderHint = hint;
      tokens = tokens.slice(1);
    }
  }

  // Prefixy od začátku, včetně spojek mezi dvěma tituly.
  const prefixTokens: string[] = [];
  let i = 0;
  while (i < tokens.length - 1) {
    const token = tokens[i] ?? '';
    const key = tokenKey(token);
    if (PREFIX_TITLES.has(key)) {
      prefixTokens.push(token);
      i += 1;
      continue;
    }
    // Spojka se bere jen tehdy, když po ní následuje další titul.
    if (
      CONJUNCTIONS.has(key) &&
      prefixTokens.length > 0 &&
      i + 1 < tokens.length - 1 &&
      PREFIX_TITLES.has(tokenKey(tokens[i + 1] ?? ''))
    ) {
      prefixTokens.push(token);
      i += 1;
      continue;
    }
    break;
  }
  tokens = tokens.slice(i);

  // Sufixy od konce bez čárky.
  if (titleSuffix === null) {
    const suffixTokens: string[] = [];
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1] ?? '';
      if (!SUFFIX_TITLES.has(tokenKey(last))) break;
      suffixTokens.unshift(last);
      tokens = tokens.slice(0, -1);
    }
    if (suffixTokens.length > 0) titleSuffix = suffixTokens.join(' ');
  }

  const rest = tokens.join(' ');
  if (rest.length === 0) {
    // Hodnota byla složená jen z titulů. Radši ji necháme celou, než abychom vyrobili prázdno.
    return { titlePrefix: null, titleSuffix: null, rest: value, genderHint: undefined };
  }

  return {
    titlePrefix: prefixTokens.length > 0 ? prefixTokens.join(' ') : null,
    titleSuffix,
    rest,
    genderHint,
  };
}
