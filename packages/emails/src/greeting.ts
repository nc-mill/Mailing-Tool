/**
 * SKLADATEL OSLOVENÍ. Jediné místo, kde se rozhoduje, jak zní věta, kterou
 * příjemce uvidí na prvním řádku.
 *
 * BYDLEL V `@mlain/core/contacts/naming/greeting` a přestěhoval se sem BEZE ZMĚNY
 * CHOVÁNÍ, ze stejného důvodu jako předtím `preview-data.ts`: tutéž větu potřebuje
 * složit i editor v prohlížeči, aby uživateli ukázal, co značka „Oslovení" vyrobí,
 * a `@mlain/core` sahá na databázi, takže se do prohlížeče importovat nesmí.
 *
 * Původní cesta v jádře zůstala a jen odsud reexportuje, takže všichni dosavadní
 * volající (přepočet oslovení, kontrola pátého pádu, zápis kontaktu) míří dál tam,
 * kam mířili. Druhá kopie těchhle vět by znamenala, že editor slibuje jednu větu
 * a odesílač pošle jinou, a poznalo by se to až u příjemce.
 *
 * Nikdy nesmí vzniknout „Dobrý den, " s visící čárkou. Je na to samostatné
 * akceptační kritérium 22 a test, který projde všechny kombinace prázdných polí
 * včetně bílých znaků.
 */

/** Tvarově týž typ jako `Gender` v `@mlain/core/contacts/naming/types`. */
export type GreetingGender = 'female' | 'male' | 'unknown';

/** Tvarově týž typ jako `Confidence` v `@mlain/core/contacts/naming/types`. */
export type GreetingConfidence = 'high' | 'low' | 'none';

export type GreetingInput = {
  locale: string;
  /** Ze sloupce workspaces.address_form, který vlastní část 1. */
  addressForm: 'formal' | 'informal';
  /** Ze settings.contacts.salutation_by. */
  salutationBy: 'first_name' | 'surname';
  /** Ze settings.contacts.vocative_policy. Výchozí je 'strict'. */
  vocativePolicy: 'strict' | 'balanced';
  firstName: string | null;
  lastName: string | null;
  gender: GreetingGender;
  firstNameVocative: string | null;
  lastNameVocative: string | null;
  vocativeConfidence: GreetingConfidence;
};

export type GreetingResult = {
  greeting: string;
  greetingNeutral: string;
};

type Texts = {
  formalNeutral: string;
  informalNeutral: string;
  formalWithName: (name: string) => string;
  informalWithName: (name: string) => string;
  formalSurname: (gender: 'female' | 'male', surname: string) => string;
};

const EN: Texts = {
  formalNeutral: 'Hello',
  informalNeutral: 'Hi',
  formalWithName: (name) => `Hello ${name}`,
  informalWithName: (name) => `Hi ${name}`,
  formalSurname: (gender, surname) =>
    gender === 'female' ? `Dear Ms ${surname},` : `Dear Mr ${surname},`,
};

const TEXTS: Record<string, Texts> = {
  cs: {
    formalNeutral: 'Dobrý den',
    informalNeutral: 'Ahoj',
    formalWithName: (name) => `Dobrý den, ${name}`,
    informalWithName: (name) => `Ahoj ${name}`,
    formalSurname: (gender, surname) =>
      gender === 'female' ? `Vážená paní ${surname},` : `Vážený pane ${surname},`,
  },
  sk: {
    formalNeutral: 'Dobrý deň',
    informalNeutral: 'Ahoj',
    formalWithName: (name) => `Dobrý deň, ${name}`,
    informalWithName: (name) => `Ahoj ${name}`,
    formalSurname: (gender, surname) =>
      gender === 'female' ? `Vážená pani ${surname},` : `Vážený pán ${surname},`,
  },
  en: EN,
};

function textsFor(locale: string): Texts {
  return TEXTS[locale.toLowerCase().split('-')[0] ?? 'en'] ?? EN;
}

/** Jazyky, pro které se vokativ počítá. Pro ostatní se vrací nominativ. */
const VOCATIVE_LOCALES = new Set(['cs', 'sk']);

/**
 * Stojí tady, ne u výpočtu vokativu v jádře: skladatel oslovení se podle toho
 * rozhoduje a jádro to odsud jen reexportuje. Dvě kopie seznamu jazyků by
 * znamenaly, že se editor a odesílač můžou rozejít v tom, které jazyky skloňují.
 */
export function localeHasVocative(locale: string): boolean {
  return VOCATIVE_LOCALES.has(locale.toLowerCase().split('-')[0] ?? '');
}

/**
 * Sestaví hotové oslovení podle tabulky ve 4.4.7 části 2.
 *
 * `greeting` je hotový řetězec uložený ve sloupci, ne funkce v šabloně. Důvod je
 * v kapitole 6.3 hlavní specifikace: šablona nesmí skládat oslovení z fragmentů,
 * protože pak by pravidla pro vokativ musela existovat na dvou místech a jedno
 * z nich by se časem rozešlo.
 *
 * `greetingNeutral` se počítá TOUTÉŽ funkcí, jen s vynuceným `useVocative` false.
 * Část 4a na něm staví tlačítko „Poslat s neutrálním oslovením" a bez druhého
 * sloupce by musela z hotového řetězce zpětně odstraňovat jméno.
 */
export function buildGreeting(input: GreetingInput): GreetingResult {
  const useVocative =
    input.vocativeConfidence === 'high' ||
    (input.vocativePolicy === 'balanced' && input.vocativeConfidence === 'low');

  return {
    greeting: compose(input, useVocative),
    greetingNeutral: compose(input, false),
  };
}

function compose(input: GreetingInput, useVocative: boolean): string {
  const texts = textsFor(input.locale);

  // informal a surname nedává smysl a spadne na informal a first_name.
  const mode =
    input.addressForm === 'informal'
      ? 'informal_first'
      : input.salutationBy === 'surname'
        ? 'formal_surname'
        : 'formal_first';

  // V jazyce bez vokativu se oslovuje NOMINATIVEM, ne uloženým vokativem.
  //
  // ODCHYLKA OD PLÁNU, VYNUCENÁ JEHO VLASTNÍMI VEKTORY: plán bral vždycky
  // firstNameVocative, ale testový vektor pro anglický projekt žádá "Hello Jana"
  // u kontaktu, jehož firstNameVocative je "Jano". Sloupec s vokativem se plní i u
  // kontaktu, který se později dostane pod projekt s jiným jazykem, takže výběr podle
  // jazyka oslovení je jediný tvar, ve kterém oba vektory platí. Když nominativ chybí,
  // sáhne se na vokativ, aby oslovení nespadlo na neutrální jen kvůli prázdnému sloupci.
  const useNominative = !localeHasVocative(input.locale);
  const firstName =
    nonEmpty(useNominative ? input.firstName : input.firstNameVocative) ??
    nonEmpty(input.firstNameVocative);

  if (mode === 'formal_surname') {
    const surname =
      nonEmpty(useNominative ? input.lastName : input.lastNameVocative) ??
      nonEmpty(input.lastNameVocative);
    if (useVocative && surname !== null && (input.gender === 'female' || input.gender === 'male')) {
      return texts.formalSurname(input.gender, surname);
    }
    // Spadne na oslovení křestním jménem, ne na prázdno.
    return useVocative && firstName !== null
      ? texts.formalWithName(firstName)
      : texts.formalNeutral;
  }

  if (mode === 'informal_first') {
    return useVocative && firstName !== null
      ? texts.informalWithName(firstName)
      : texts.informalNeutral;
  }

  return useVocative && firstName !== null ? texts.formalWithName(firstName) : texts.formalNeutral;
}

/**
 * Prázdný a bílý řetězec se chová stejně jako null. Bez téhle kontroly by hodnota
 * s jednou mezerou vyrobila "Dobrý den,  " s visící čárkou, což je přesně to,
 * co kritérium 22 zakazuje.
 */
function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
