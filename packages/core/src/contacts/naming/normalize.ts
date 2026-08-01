import type { NameWarning } from './types';

/**
 * ODCHYLKA OD PLÁNU, JEN TYPOGRAFICKÁ: plán měl znaky v regulárních výrazech doslova.
 * Nedělitelná mezera, úzká nedělitelná mezera a kombinovací znaky jsou v editoru
 * k nerozeznání od okolí, takže se tady píšou escape sekvencemi. Množiny jsou tytéž.
 */
const ZS_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
// Řídicí znaky jsou v téhle třídě ZÁMĚRNĚ: z hodnoty jména se odstraňují, ne hledají omylem.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const COMBINING = /[\u0300-\u036f]/g;
const MULTI_SPACE = / {2,}/g;

/** Maximální délka jedné složky jména. Nad ni se hodnota zkrátí s varováním. */
export const NAME_MAX_LENGTH = 100;

/**
 * Kanonický tvar jména: malá písmena, NFD a odstraněné kombinovací znaky.
 *
 * Tuhle funkci používají TŘI místa a musí být bajt za bajt stejná ve všech:
 *   1. vyhledání ve slovníku křestních jmen (4.4.4),
 *   2. vyhledání v name_overrides (3.7),
 *   3. seskupení fronty ke kontrole vokativu (4.5.2), přes sloupce first_name_key a last_name_key.
 *
 * Kdyby se lišila, "Tomáš" a "Tomas" by tvořily dvě skupiny fronty, override zapsaný bez
 * diakritiky by tvar s diakritikou netrefil, a fronta by se nikdy nevyprázdnila. Je to
 * skutečný nález z revize a kryje ho akceptační kritérium 30.
 *
 * Normalizace se počítá v aplikaci, ne rozšířením unaccent, ze tří důvodů: nepřidává
 * závislost na dalším rozšíření v době, kdy část 1 povoluje jen citext; je to jedna
 * implementace pro tři místa, takže nemohou dát tři různé odpovědi; a seskupení nad uloženým
 * sloupcem je index-friendly, kdežto GROUP BY nad výrazem by znamenal výrazový index
 * nebo sekvenční průchod.
 */
export function normalizeNameKey(value: string): string {
  return value.normalize('NFD').replace(COMBINING, '').replace(ZS_SPACES, ' ').trim().toLowerCase();
}

/** Normalizace vstupní hodnoty jména podle 4.4.1. Vrací null, když po normalizaci nic nezbude. */
export function normalizeNameValue(raw: string | null | undefined): {
  value: string | null;
  warnings: NameWarning[];
} {
  if (raw === null || raw === undefined) return { value: null, warnings: [] };

  const warnings: NameWarning[] = [];
  let value = raw
    .normalize('NFC')
    .replace(ZS_SPACES, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(MULTI_SPACE, ' ')
    .trim();

  if (value.length === 0) return { value: null, warnings };

  if (value.length > NAME_MAX_LENGTH) {
    value = value.slice(0, NAME_MAX_LENGTH);
    warnings.push('value_truncated');
  }

  return { value, warnings };
}

/**
 * Rozsahy písem mimo latinku: azbuka, řečtina, hebrejština, arabské písmo, dévanágarí,
 * kana, CJK a hangul. Pro jméno v jednom z nich se vokativ nepočítá vůbec, protože
 * česká morfologie na takové jméno nedává smysl. Jméno se uloží tak, jak přišlo.
 *
 * Vietnamština tady záměrně NENÍ: píše se latinkou s diakritikou z rozsahu Latin Extended
 * Additional, takže "Nguyễn" je 'latin' a projde běžnou cestou.
 */
const NON_LATIN =
  // Dévanágarí a kana mají v rozsahu i kombinovací znaky. Hledá se tu JEDEN znak písma,
  // ne celý grafém, takže je to správně; pravidlo o tom vědět nemůže.
  // eslint-disable-next-line no-misleading-character-class
  /[\u0370-\u03ff\u0400-\u04ff\u0500-\u052f\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;

export function detectScript(value: string): 'latin' | 'non_latin' {
  return NON_LATIN.test(value) ? 'non_latin' : 'latin';
}
