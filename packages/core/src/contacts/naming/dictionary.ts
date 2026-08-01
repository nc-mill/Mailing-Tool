import givenNames from './data/given-names.json' with { type: 'json' };
import vietnameseSurnames from './data/vietnamese-surnames.json' with { type: 'json' };
import { normalizeNameKey } from './normalize';
import type { Gender } from './types';

type RawEntry = { g: 'm' | 'f' | 'u'; ambiguous?: boolean };

const GENDER_BY_CODE: Record<RawEntry['g'], Gender> = { m: 'male', f: 'female', u: 'unknown' };

const DICTIONARY = givenNames as Record<string, RawEntry>;
const VIETNAMESE = new Set<string>(vietnameseSurnames as string[]);

export type GivenNameEntry = { gender: Gender; ambiguous: boolean };

/**
 * Vyhledá křestní jméno ve slovníku. Klíč se počítá funkcí normalizeNameKey, takže
 * "Tomáš" i "Tomas" trefí tentýž záznam.
 *
 * Modul funguje i s prázdným slovníkem: pravidla 5 a 6 z tabulky ve 4.4.4 se přeskočí
 * a zvýší se podíl jistoty 'low'. Cílový rozsah slovníku je 4 000 až 6 000 položek,
 * ale jeho licence je otevřená otázka O5 části 2 a nic na ni nečeká.
 */
export function lookupGivenName(name: string): GivenNameEntry | undefined {
  const key = normalizeNameKey(name);
  if (key.length === 0) return undefined;
  const entry = DICTIONARY[key];
  if (entry === undefined) return undefined;
  return { gender: GENDER_BY_CODE[entry.g], ambiguous: entry.ambiguous === true };
}

/** Je token jedno z nejčastějších vietnamských příjmení v Česku? */
export function isVietnameseSurname(token: string): boolean {
  return VIETNAMESE.has(normalizeNameKey(token));
}

/** Klíče obourodých jmen. Používá se v testech a v diagnostice fronty ke kontrole. */
export const AMBIGUOUS_GIVEN_NAMES: readonly string[] = Object.entries(DICTIONARY)
  .filter(([, entry]) => entry.ambiguous === true)
  .map(([key]) => key);
