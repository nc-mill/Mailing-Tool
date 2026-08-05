/**
 * JAK JE NA TOM OSLOVENÍ JEDNOHO KONTAKTU.
 *
 * Oslovení v 5. pádu je hlavní odlišující vlastnost produktu, ale do téhle chvíle
 * nebylo nikde vidět, JESTLI ho kontakt vůbec má a odkud se vzalo. Detail ukazoval
 * hotovou větu a visací zámek, seznam neukazoval nic. Uživatel, kterému se v náhledu
 * šablony objevilo „Dobrý den, Petr" místo „Dobrý den, Petře", tedy neměl kde zjistit,
 * že jeho kontakt má uložený tvar „Petr" a proč.
 *
 * Tenhle soubor je ČISTÁ FUNKCE nad tím, co vrací API kontaktů, a nic víc. Bydlí
 * v apps/web schválně: konzumují ho klientské komponenty a doména `@mlain/core/contacts`
 * sahá na databázi, takže se do prohlížeče importovat NESMÍ. Pravidla samotná jsou
 * pořád jen jedna, tady se jen POJMENOVÁVÁ stav, který spočítalo jádro a který leží
 * ve sloupcích.
 */

/**
 * Jazyky, ve kterých se 5. pád počítá. Zrcadlí `VOCATIVE_LOCALES`
 * v `packages/core/src/contacts/naming/vocative.ts`; shodu obou seznamů hlídá test
 * `greeting-status.test.ts`, který se ptá skutečného `resolveName`, ne téhle konstanty.
 */
const VOCATIVE_LOCALES = new Set(['cs', 'sk']);

export function localeHasVocative(locale: string): boolean {
  return VOCATIVE_LOCALES.has(locale.toLowerCase().split('-')[0] ?? '');
}

export type GreetingStatusInput = {
  /** Hotová věta ze sloupce `contacts.greeting`. */
  greeting: string;
  first_name: string | null;
  first_name_vocative: string | null;
  vocative_confidence: 'high' | 'low' | 'none';
  vocative_locked: boolean;
  /** Jazyk KONTAKTU, ne projektu. Vokativ se řídí jím, viz `computeVocative`. */
  locale: string;
};

/**
 * `noVocativeLocale` je stav, kvůli kterému tenhle soubor vznikl. Kontakt uložený
 * pod projektem s jazykem `en` projde `computeVocative` větví „jazyk bez vokativu",
 * dostane do sloupce NOMINATIV a jistotu `high`. Zvenčí to vypadá jako spolehlivě
 * spočítaný 5. pád, přestože se nepočítal vůbec. Bez vlastního stavu by se takový
 * kontakt tvářil stejně jako správně vyskloňovaný.
 */
export type GreetingStatusKind = 'locked' | 'noVocativeLocale' | 'derived' | 'guessed' | 'noName';

export type GreetingStatus = {
  kind: GreetingStatusKind;
  /** Klíč do `contacts.greeting.*`. Popisek odznaku. */
  labelKey: `greeting.status.${GreetingStatusKind}`;
  /** Klíč do `contacts.greeting.*`. Věta, která stav vysvětlí. */
  hintKey: `greeting.hint.${GreetingStatusKind}`;
  tone: 'success' | 'neutral' | 'warning';
  /** true znamená „tohle patří do fronty Kontrola oslovení". */
  needsReview: boolean;
};

/**
 * Pořadí podmínek je významné a je to pořadí podle SÍLY TVRZENÍ:
 *
 *  1. Ruční potvrzení přebíjí všechno. Člověk tvar viděl a odsouhlasil.
 *  2. Kontakt bez jména nemá co skloňovat, a neutrální „Dobrý den" je u něj správně,
 *     ne chyba. Kdyby se hlásil jako nejistý, byla by fronta plná lidí, u kterých
 *     není co rozhodnout.
 *  3. Jazyk bez vokativu se hlásí PŘED jistotou, protože jistota je v téhle větvi
 *     vždycky `high` a sama o sobě by lhala.
 *  4. Teprve pak rozhoduje jistota výpočtu.
 */
export function describeGreetingStatus(input: GreetingStatusInput): GreetingStatus {
  if (input.vocative_locked) return status('locked', 'success', false);

  const hasName =
    nonEmpty(input.first_name) !== null || nonEmpty(input.first_name_vocative) !== null;
  if (!hasName || input.vocative_confidence === 'none') return status('noName', 'neutral', false);

  if (!localeHasVocative(input.locale)) return status('noVocativeLocale', 'warning', true);

  if (input.vocative_confidence === 'low') return status('guessed', 'warning', true);

  return status('derived', 'success', false);
}

function status(
  kind: GreetingStatusKind,
  tone: GreetingStatus['tone'],
  needsReview: boolean,
): GreetingStatus {
  return {
    kind,
    labelKey: `greeting.status.${kind}`,
    hintKey: `greeting.hint.${kind}`,
    tone,
    needsReview,
  };
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Tvar, kterým se kontakt osloví jménem. Do sloupce `greeting` se ukládá celá věta
 * („Dobrý den, Petře"), ale v tabulce potřebujeme vidět SAMOTNÝ TVAR, protože právě
 * v něm je rozdíl mezi „Petr" a „Petře" a věta ho utopí.
 */
export function vocativeForm(input: GreetingStatusInput): string | null {
  return nonEmpty(input.first_name_vocative) ?? nonEmpty(input.first_name);
}
