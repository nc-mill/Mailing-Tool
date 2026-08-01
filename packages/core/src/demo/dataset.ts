import { DEMO_SOURCE_REF, DEMO_TAG_NAME } from './manifest';

export type DemoGender = 'male' | 'female' | 'unknown';

export type DemoContact = {
  firstName: string | null;
  lastName: string | null;
  titlePrefix: string | null;
  gender: DemoGender;
  email: string;
  /** Předpočítané oslovení, aby bylo v souboru vidět, jak správný vokativ vypadá. */
  greeting: string;
  city: string;
  listKeys: readonly string[];
  tagKeys: readonly string[];
  sourceRef: string;
};

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      // Kombinovací znaky U+0300 až U+036F, zapsané escapem: v plánu byly
      // napsané doslova a takový zápis se při každém kopírování souboru rozpadne.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  );
}

const female = (
  firstName: string,
  lastName: string,
  vocative: string,
  city: string,
  lists: readonly string[],
  tags: readonly string[],
  titlePrefix: string | null = null,
): DemoContact => ({
  firstName,
  lastName,
  titlePrefix,
  gender: 'female',
  email: `${slug(firstName)}.${slug(lastName)}@example.com`,
  greeting: `Dobrý den, ${vocative}`,
  city,
  listKeys: lists,
  tagKeys: tags,
  sourceRef: DEMO_SOURCE_REF,
});

const male = (
  firstName: string,
  lastName: string,
  vocative: string,
  city: string,
  lists: readonly string[],
  tags: readonly string[],
  titlePrefix: string | null = null,
): DemoContact => ({
  firstName,
  lastName,
  titlePrefix,
  gender: 'male',
  email: `${slug(firstName)}.${slug(lastName)}@example.com`,
  greeting: `Dobrý den, ${vocative}`,
  city,
  listKeys: lists,
  tagKeys: tags,
  sourceRef: DEMO_SOURCE_REF,
});

const ALL = ['zakaznici'] as const;
const NEWS = ['novinky'] as const;
const VIP = ['vip'] as const;

/**
 * Padesát kontaktů. Specifikace 8.1.4 mluví o dvou stech, zadavatel rozhodl
 * pro padesát (rozhodnutí Z1 v kapitole 0.3 plánu). Není to opomenutí.
 *
 * Adresy jsou výhradně na example.com podle RFC 2606, takže se na ně fyzicky
 * nedá nic doručit ani omylem.
 *
 * Jména jsou skutečná česká jména obou rodů a schválně mezi nimi jsou i taková,
 * kde je vokativ netriviální: Petr → Petře, Radek → Radku, Marek → Marku,
 * Vojtěch → Vojtěchu, Daniel → Danieli, kdežto Jiří, Lucie a Marie se nemění.
 * Že se předpočítané oslovení shoduje s tím, co spočítá skutečný algoritmus
 * vokativu z domény kontaktů, hlídá test `dataset.test.ts`.
 */
export const DEMO_CONTACTS: readonly DemoContact[] = [
  female('Jana', 'Nováková', 'Jano', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Ondřej', 'Dvořák', 'Ondřeji', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Petr', 'Svoboda', 'Petře', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha'], 'Ing.'),
  female('Lucie', 'Černá', 'Lucie', 'Ostrava', [...ALL], ['ukazkova-data']),
  female('Eva', 'Procházková', 'Evo', 'Plzeň', [...ALL, ...NEWS], ['ukazkova-data']),
  male('Jakub', 'Kučera', 'Jakube', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Tereza', 'Veselá', 'Terezo', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Martin', 'Horák', 'Martine', 'Liberec', [...ALL], ['ukazkova-data']),
  female('Kateřina', 'Němcová', 'Kateřino', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  male('Tomáš', 'Marek', 'Tomáši', 'Olomouc', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Veronika', 'Pospíšilová', 'Veroniko', 'Zlín', [...ALL], ['ukazkova-data']),
  male('Jiří', 'Pokorný', 'Jiří', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  female('Hana', 'Marková', 'Hano', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  male('Josef', 'Král', 'Josefe', 'České Budějovice', [...ALL], ['ukazkova-data']),
  female(
    'Michaela',
    'Benešová',
    'Michaelo',
    'Praha',
    [...ALL, ...NEWS],
    ['ukazkova-data', 'praha'],
  ),
  male('David', 'Růžička', 'Davide', 'Pardubice', [...ALL], ['ukazkova-data']),
  female('Petra', 'Fialová', 'Petro', 'Hradec Králové', [...ALL, ...VIP], ['ukazkova-data']),
  male('Miroslav', 'Sedláček', 'Miroslave', 'Ústí nad Labem', [...ALL], ['ukazkova-data']),
  female('Lenka', 'Doležalová', 'Lenko', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Pavel', 'Zeman', 'Pavle', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  female('Marie', 'Kolářová', 'Marie', 'Jihlava', [...ALL], ['ukazkova-data']),
  male('Lukáš', 'Navrátil', 'Lukáši', 'Karlovy Vary', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Alena', 'Čermáková', 'Aleno', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Radek', 'Vaněk', 'Radku', 'Brno', [...ALL, ...VIP], ['ukazkova-data', 'brno']),
  female('Simona', 'Bláhová', 'Simono', 'Ostrava', [...ALL], ['ukazkova-data']),
  male('Vojtěch', 'Kříž', 'Vojtěchu', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  female('Barbora', 'Malá', 'Barboro', 'Plzeň', [...ALL], ['ukazkova-data']),
  male('Filip', 'Šimek', 'Filipe', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Nikola', 'Řezníková', 'Nikolo', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Adam', 'Urban', 'Adame', 'Zlín', [...ALL], ['ukazkova-data']),
  female('Klára', 'Sovová', 'Kláro', 'Olomouc', [...ALL, ...VIP], ['ukazkova-data']),
  male('Daniel', 'Chalupa', 'Danieli', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  female('Monika', 'Žáková', 'Moniko', 'Liberec', [...ALL, ...NEWS], ['ukazkova-data']),
  male('Roman', 'Havel', 'Romane', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Zuzana', 'Cimrmanová', 'Zuzano', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Karel', 'Čapek', 'Karle', 'Ostrava', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Ivana', 'Kratochvílová', 'Ivano', 'Pardubice', [...ALL], ['ukazkova-data']),
  male('Vladimír', 'Bureš', 'Vladimíre', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  female('Denisa', 'Vlčková', 'Deniso', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  male('Zdeněk', 'Musil', 'Zdeňku', 'Jihlava', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Andrea', 'Holubová', 'Andreo', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Marek', 'Konečný', 'Marku', 'Zlín', [...ALL], ['ukazkova-data']),
  female('Kristýna', 'Bartošová', 'Kristýno', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Ivan', 'Kadlec', 'Ivane', 'Ostrava', [...ALL], ['ukazkova-data']),
  female('Šárka', 'Vávrová', 'Šárko', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  male('Ladislav', 'Blažek', 'Ladislave', 'Plzeň', [...ALL], ['ukazkova-data']),
  {
    // Jméno bez rodového vodítka. Oslovení musí spadnout na neutrální tvar,
    // ne hádat rod a oslovit člověka špatně.
    firstName: 'Sam',
    lastName: 'Bergström',
    titlePrefix: null,
    gender: 'unknown',
    email: 'sam.bergstrom@example.com',
    greeting: 'Dobrý den',
    city: 'Praha',
    listKeys: [...ALL],
    tagKeys: ['ukazkova-data', 'praha'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    // Rod se dá odvodit z příjmení, ale vokativ křestního jména je nejistý,
    // protože „Robin" není v slovníku jmen. Přísná politika vokativu proto
    // oslovení nechá neutrální. Je to nejužitečnější řádek celé sady:
    // uživatel na něm vidí, že se produkt v nejistotě raději nehádá.
    firstName: 'Robin',
    lastName: 'Novotný',
    titlePrefix: null,
    gender: 'male',
    email: 'robin.novotny@example.com',
    greeting: 'Dobrý den',
    city: 'Brno',
    listKeys: [...ALL, ...NEWS],
    tagKeys: ['ukazkova-data', 'brno'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    // Adresa bez jména, tedy nejčastější případ z importu z e-shopu.
    firstName: null,
    lastName: null,
    titlePrefix: null,
    gender: 'unknown',
    email: 'objednavky@example.com',
    greeting: 'Dobrý den',
    city: 'Praha',
    listKeys: [...ALL],
    tagKeys: ['ukazkova-data'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    firstName: 'Alexandra',
    lastName: 'Dvořáková',
    titlePrefix: 'MUDr.',
    gender: 'female',
    email: 'alexandra.dvorakova@example.com',
    greeting: 'Dobrý den, Alexandro',
    city: 'Praha',
    listKeys: [...ALL, ...VIP],
    tagKeys: ['ukazkova-data', 'praha'],
    sourceRef: DEMO_SOURCE_REF,
  },
];

/**
 * POZOR na `key`. Není to sloupec v databázi.
 *
 * `tags`, `lists`, `segments` ani `templates` sloupec `slug` NEMAJÍ, ověřeno
 * proti schématu P03. `key` slouží jen k tomu, aby na sebe položky téhle sady
 * mohly odkazovat (kontakt na štítek, kampaň na šablonu) dřív, než databáze
 * přidělí identifikátory. Do žádného INSERTu nevstupuje.
 */
export type DemoList = { key: string; name: string; description: string };

export const DEMO_LISTS: readonly DemoList[] = [
  { key: 'zakaznici', name: 'Zákazníci', description: 'Lidé, kteří u vás už nakoupili.' },
  { key: 'novinky', name: 'Novinky', description: 'Přihlásili se k odběru novinek.' },
  { key: 'vip', name: 'VIP', description: 'Nejvěrnější zákazníci.' },
];

export type DemoTag = { key: string; name: string };

export const DEMO_TAGS: readonly DemoTag[] = [
  { key: 'ukazkova-data', name: DEMO_TAG_NAME },
  { key: 'praha', name: 'Praha' },
  { key: 'brno', name: 'Brno' },
  { key: 'newsletter', name: 'Newsletter' },
];

export type DemoSegment = { key: string; name: string; definition: unknown };

export const DEMO_SEGMENTS: readonly DemoSegment[] = [
  {
    key: 'ukazka-praha',
    name: 'Ukázka: kontakty z Prahy',
    definition: {
      op: 'and',
      not: false,
      conditions: [{ field: 'tag', operator: 'has_any', value: ['praha'] }],
    },
  },
  {
    key: 'ukazka-aktivni-90',
    name: 'Ukázka: aktivní za posledních 90 dní',
    definition: {
      op: 'and',
      not: false,
      conditions: [
        { field: 'tag', operator: 'has_any', value: ['ukazkova-data'] },
        { field: 'last_open_at', operator: 'in_last_days', value: 90 },
      ],
    },
  },
];

/**
 * Šablona nese `design`, ne `blocks`, a **žádný předmět**: `templates.subject`
 * ve schématu není, předmět je vlastnost kampaně. Obojí ověřeno proti P03.
 */
export type DemoTemplate = { key: string; name: string; design: unknown };

export const DEMO_TEMPLATES: readonly DemoTemplate[] = [
  {
    key: 'ukazka-newsletter',
    name: 'Ukázka: měsíční newsletter',
    design: {
      version: 1,
      sections: [
        { type: 'heading', level: 1, text: 'Novinky za červenec' },
        { type: 'text', text: '{{ contact.greeting }}, tady je přehled toho, co je u nás nového.' },
        { type: 'button', text: 'Podívat se', href: 'https://example.com/novinky' },
        { type: 'unsubscribe' },
      ],
    },
  },
  {
    key: 'ukazka-vyprodej',
    name: 'Ukázka: pozvánka na výprodej',
    design: {
      version: 1,
      sections: [
        { type: 'heading', level: 1, text: 'Letní výprodej začíná' },
        { type: 'text', text: '{{ contact.greeting }}, sleva platí do neděle.' },
        { type: 'button', text: 'Do výprodeje', href: 'https://example.com/vyprodej' },
        { type: 'unsubscribe' },
      ],
    },
  },
];

export type DemoCampaign = {
  key: string;
  name: string;
  subject: string;
  templateKey: string;
  listKey: string;
  stats: {
    sent: number;
    delivered: number;
    openedUnique: number;
    openedUniqueApple: number;
    clickedUnique: number;
    /** campaign_stats dělí nedoručení na tvrdá a měkká, sloupec `bounced` nemá. */
    bouncedHard: number;
    bouncedSoft: number;
    complained: number;
    unsubscribed: number;
  };
};

export const DEMO_CAMPAIGN: DemoCampaign = {
  key: 'ukazka-letni-vyprodej',
  name: 'Ukázka: Letní výprodej',
  subject: 'Letní výprodej začíná',
  templateKey: 'ukazka-vyprodej',
  listKey: 'zakaznici',
  stats: {
    sent: 50,
    delivered: 48,
    openedUnique: 21,
    openedUniqueApple: 8,
    clickedUnique: 7,
    bouncedHard: 1,
    bouncedSoft: 1,
    complained: 1,
    unsubscribed: 1,
  },
};

const DEMO_CAMPAIGN_AGE_DAYS = 3;

/**
 * Kampaň se datuje tři dny zpět, ale nikdy před začátek aktuálního měsíce.
 * `messages`, `message_events` a `message_engagement` jsou partitionované po
 * měsících, `DEFAULT` partition se schválně nezakládá a zápis mimo okno tvrdě
 * spadne. Bez tohohle oříznutí by seed první tři dny v měsíci padal.
 */
export function demoCampaignSentAt(now: Date): Date {
  const candidate = new Date(now.getTime() - DEMO_CAMPAIGN_AGE_DAYS * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return candidate < monthStart ? monthStart : candidate;
}
