import { isVietnameseSurname, lookupGivenName } from './dictionary';
import { normalizeNameKey } from './normalize';
import type { Confidence, NameWarning } from './types';

/** Koncovky, které u jednoho tokenu spolehlivě ukazují na příjmení. */
const SURNAME_ENDINGS_STRONG = ['ová', 'ská', 'cká', 'ova', 'ska', 'cka', 'ů'];

/** Koncovky, které u dvou tokenů ukazují na příjmení v první pozici. */
const SURNAME_MARKERS = ['ová', 'ská', 'cká', 'ov', 'ev', 'ský', 'cký', 'ý'];

/** Předložkové a šlechtické částice. Částice a všechno za ní patří k příjmení. */
const PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'da',
  'di',
  'du',
  'des',
  'la',
  'le',
  'ze',
  'z',
  'y',
  'bin',
  'ibn',
  'al',
  'abu',
  'mac',
  'mc',
  "o'",
  'ter',
  'ten',
  'vander',
  'der',
]);

const VOWELS = 'aeiouyáéíóúůýě';

export type SplitResult = {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  confidence: Confidence;
  warnings: NameWarning[];
};

function endsWithAny(value: string, endings: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return endings.some((ending) => lower.endsWith(ending));
}

/** Adjektivní ženské příjmení: končí na "á" po souhlásce (Novotná, Malá, Tichá). */
function isAdjectivalFeminine(value: string): boolean {
  const lower = value.toLowerCase();
  if (!lower.endsWith('á')) return false;
  const before = lower.slice(-2, -1);
  return before.length === 1 && !VOWELS.includes(before);
}

/**
 * Rozdělí jeden sloupec se jménem na křestní jméno, prostřední jména a příjmení
 * podle tabulky v kapitole 4.4.3 části 2.
 *
 * Vstup už NEOBSAHUJE tituly, ty odebírá extractTitles. Pomlčkou spojená příjmení
 * a jména s apostrofem jsou vždy jeden token, protože se dělí jen podle mezer.
 *
 * Oddělení křestního jména a příjmení je výslovný požadavek zadavatele. Databáze má pro
 * obojí samostatný sloupec a celé oslovení stojí na tom, že se nezamění: kdyby se
 * "Nováková" dostala do first_name, oslovení by znělo "Dobrý den, Novákovo".
 */
export function splitFullName(
  raw: string,
  nameOrder: 'auto' | 'first_last' | 'last_first',
): SplitResult {
  const warnings: NameWarning[] = [];
  const hadComma = raw.includes(',');
  const tokens = raw
    .replace(',', ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return {
      firstName: null,
      lastName: null,
      middleName: null,
      confidence: 'none',
      warnings: ['name_empty'],
    };
  }

  if (tokens.length === 1) {
    const token = tokens[0] ?? '';
    // ODCHYLKA OD PLÁNU: plán tady zkoušel jen SURNAME_ENDINGS_STRONG, takže adjektivní
    // ženská příjmení ("Novotná", "Tichá") by skončila jako křestní jméno s nízkou
    // jistotou. Testový vektor plánu si přitom u "Novotná" žádá příjmení s vysokou
    // jistotou, a stejné pravidlo už plán používá o dva bloky níž. Doplněno, ne změněno.
    if (endsWithAny(token, SURNAME_ENDINGS_STRONG) || isAdjectivalFeminine(token)) {
      return { firstName: null, lastName: token, middleName: null, confidence: 'high', warnings };
    }
    if (lookupGivenName(token) !== undefined) {
      return { firstName: token, lastName: null, middleName: null, confidence: 'high', warnings };
    }
    warnings.push('name_split_low_confidence');
    return { firstName: token, lastName: null, middleName: null, confidence: 'low', warnings };
  }

  if (tokens.length === 2) {
    const t1 = tokens[0] ?? '';
    const t2 = tokens[1] ?? '';

    if (nameOrder === 'first_last') {
      return { firstName: t1, lastName: t2, middleName: null, confidence: 'high', warnings };
    }
    if (nameOrder === 'last_first') {
      return { firstName: t2, lastName: t1, middleName: null, confidence: 'high', warnings };
    }

    // Čárka mezi tokeny je jednoznačný signál obráceného pořadí.
    if (hadComma) {
      return { firstName: t2, lastName: t1, middleName: null, confidence: 'high', warnings };
    }

    const t1IsGiven = lookupGivenName(t1) !== undefined;
    const t2IsGiven = lookupGivenName(t2) !== undefined;
    const t1LooksLikeSurname = endsWithAny(t1, SURNAME_MARKERS) || isAdjectivalFeminine(t1);

    if (t1LooksLikeSurname && t2IsGiven) {
      return { firstName: t2, lastName: t1, middleName: null, confidence: 'high', warnings };
    }
    if (t2IsGiven && !t1IsGiven) {
      warnings.push('name_split_low_confidence');
      return { firstName: t2, lastName: t1, middleName: null, confidence: 'low', warnings };
    }
    if (t1IsGiven) {
      return { firstName: t1, lastName: t2, middleName: null, confidence: 'high', warnings };
    }
    warnings.push('name_split_low_confidence');
    return { firstName: t1, lastName: t2, middleName: null, confidence: 'low', warnings };
  }

  const first = tokens[0] ?? '';
  const last = tokens[tokens.length - 1] ?? '';

  // Vietnamské pořadí: příjmení první, křestní poslední.
  //
  // ODCHYLKA OD PLÁNU, POŘADÍ VĚTVÍ: plán hledal částici dřív než vietnamské příjmení.
  // Prostřední člen vietnamského jména je ale často "Van", což je v seznamu částic,
  // takže "Nguyen Van Thanh" i "Le Van Thanh" by skončily jako "Nguyen" plus příjmení
  // "Van Thanh". Oba testové vektory plánu žádají opak a komentář plánu to říká také
  // ("při třech a víc tokenech a na první pozici vyhrává vietnamská interpretace").
  // Pořadí vyhodnocení je proto obrácené, pravidla samotná se nemění.
  //
  // Kolize: "Le" je zároveň vietnamské příjmení a francouzská částice. Při třech a víc
  // tokenech a na první pozici vyhrává vietnamská interpretace, jinak je to částice.
  // Hádáme s varováním a zařazením do fronty ke kontrole, protože "vždycky se zeptat"
  // by u vietnamského seznamu znamenalo nepoužitelný import.
  if (isVietnameseSurname(first)) {
    warnings.push('vietnamese_order_assumed', 'name_split_low_confidence');
    return {
      firstName: last,
      lastName: first,
      middleName: tokens.length > 2 ? tokens.slice(1, -1).join(' ') : null,
      confidence: 'low',
      warnings,
    };
  }

  // Částice se hledá až od druhé pozice, protože na první pozici by "Le" byla
  // vietnamské příjmení, ne francouzská částice.
  const particleIndex = tokens.findIndex(
    (t, index) => index > 0 && PARTICLES.has(normalizeNameKey(t)),
  );
  if (particleIndex > 0) {
    const before = tokens.slice(0, particleIndex);
    return {
      firstName: before[0] ?? null,
      lastName: tokens.slice(particleIndex).join(' '),
      middleName: before.length > 1 ? before.slice(1).join(' ') : null,
      confidence: 'high',
      warnings,
    };
  }

  warnings.push('name_split_low_confidence');
  return {
    firstName: first,
    lastName: last,
    middleName: tokens.slice(1, -1).join(' '),
    confidence: 'low',
    warnings,
  };
}
