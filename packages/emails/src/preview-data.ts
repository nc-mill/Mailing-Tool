import { buildGreeting, type GreetingInput } from './greeting';

/**
 * NASTAVENÍ OSLOVENÍ PROJEKTU, ve kterém se vzorek ukazuje.
 *
 * Vzorový kontakt žádný projekt za sebou nemá, ale VĚTA, kterou z něj složíme,
 * ho má: vykání a tykání (`workspaces.address_form`), oslovování křestním
 * jménem nebo příjmením a přísnost vokativu jsou vlastnosti projektu, ne
 * kontaktu. Bez nich plátno v projektu s tykáním slibovalo „Dobrý den, Jano"
 * u e-mailu, který odejde s „Ahoj Jano".
 */
export type SampleGreetingSettings = Pick<
  GreetingInput,
  'addressForm' | 'salutationBy' | 'vocativePolicy'
>;

/**
 * Nastavení, které se použije, když ho volající NEZNÁ.
 *
 * Jsou to tytéž výchozí hodnoty, jaké má nový projekt (`address_form = formal`,
 * `salutation_by = first_name`, `vocative_policy = strict`), takže vzorek
 * ukazuje pravdu všude, kde se nastavení nezměnilo. Volající, který projekt
 * zná, ho předat MUSÍ; tenhle výchozí tvar je pro místa, kde žádný projekt
 * není, tedy pro jednotkové testy a ukázky.
 */
export const DEFAULT_SAMPLE_GREETING: SampleGreetingSettings = {
  addressForm: 'formal',
  salutationBy: 'first_name',
  vocativePolicy: 'strict',
};

export type SampleRenderData = {
  contact: Record<string, unknown>;
  campaign: Record<string, string>;
  workspace: Record<string, string>;
  unsubscribe_url: string;
  one_click_unsubscribe_url: string;
  preferences_url: string;
  webview_url: string;
  _context: { timezone: string; locale: string };
  _present: Record<string, boolean>;
};

/**
 * Systémové adresy vedou na #preview-disabled: nepodepisujeme reálné odhlašovací
 * tokeny pro cizí kontakt jen kvůli náhledu.
 */
/**
 * Oslovení vzorového kontaktu. SKLÁDÁ SE, nenapisuje se.
 *
 * Do 7. 8. 2026 tu stál literál „Dobrý den, Přemyslave-Řehoři". Byl to přesně
 * ten druh natvrdo psaného příkladu, který se tiše rozejde se skutečností:
 * kdyby se v `buildGreeting` změnila čárka nebo znění, náhled i editor by dál
 * slibovaly starou větu a rozdíl by se poznal až u příjemce. U varianty
 * „Kontakt bez jména" už rozejitý byl, viz `sampleFor`.
 *
 * Nastavení se BERE Z PROJEKTU, ne z výchozích hodnot, a je to oprava. Dokud
 * se sem předával jen jazyk, skládala se věta pořád podle vykání a křestního
 * jména, takže projekt s tykáním viděl na plátně i v náhledu „Dobrý den, Jano"
 * u e-mailu, který odejde s „Ahoj Jano". U skutečného kontaktu vada nebyla,
 * protože tam se bere uložený sloupec `contacts.greeting`; lhal jenom vzorek,
 * tedy přesně to, podle čeho se uživatel rozhoduje, než kampaň odešle.
 */
function sampleGreeting(
  language: 'cs' | 'en',
  firstName: string,
  vocative: string,
  greeting: SampleGreetingSettings,
): string {
  return buildGreeting({
    locale: language,
    addressForm: greeting.addressForm,
    salutationBy: greeting.salutationBy,
    vocativePolicy: greeting.vocativePolicy,
    firstName,
    lastName: null,
    gender: 'male',
    firstNameVocative: vocative,
    lastNameVocative: null,
    vocativeConfidence: 'high',
  }).greeting;
}

export function sampleRenderData(
  language: 'cs' | 'en',
  greeting: SampleGreetingSettings = DEFAULT_SAMPLE_GREETING,
): SampleRenderData {
  const cs = language === 'cs';
  const firstName = cs ? 'Přemyslav-Řehoř' : 'Zoë';
  const vocative = cs ? 'Přemyslave-Řehoři' : 'Zoë';
  return {
    contact: {
      email: 'jan.novak@example.com',
      first_name: firstName,
      last_name: '',
      first_name_vocative: vocative,
      last_name_vocative: '',
      title_prefix: 'Ing.',
      title_suffix: '',
      greeting: sampleGreeting(language, firstName, vocative, greeting),
      gender: 'male',
      locale: language,
      created_at: '2026-01-15T09:30:00Z',
      attr: {
        city: '',
        company: 'Novák & synové <s.r.o.>',
        vip: false,
      },
    },
    campaign: {
      name: cs ? 'Letní výprodej' : 'Summer sale',
      subject: cs ? 'Slevy až 50 %' : 'Up to 50% off',
      preheader: cs ? 'Končí v neděli' : 'Ends on Sunday',
    },
    workspace: {
      name: 'Demo',
      sender_address: cs
        ? 'Demo s.r.o.\nNa Příkopě 1\n110 00 Praha 1'
        : 'Demo Ltd.\n1 Main Street\nLondon',
    },
    unsubscribe_url: '#preview-disabled',
    one_click_unsubscribe_url: '#preview-disabled',
    preferences_url: '#preview-disabled',
    webview_url: '#preview-disabled',
    _context: { timezone: 'Europe/Prague', locale: language },
    // Naplní ji prepareRenderData podle renderSchema.presence, stejně jako u odeslání.
    _present: {},
  };
}

/**
 * Osobní údaje, které varianta `no_name` vyprazdňuje. E-mail mezi nimi
 * SCHVÁLNĚ není: kontakt bez adresy neexistuje a náhled bez ní by vypadal
 * rozbitě z jiného důvodu, než se testuje.
 */
const PERSONAL_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'first_name_vocative',
  'last_name_vocative',
  'greeting',
] as const;

/**
 * Vzorová data pro náhled. Varianta `no_name` je požadavek P08-R2 z kapitoly
 * 9.2 plánu P12 a kritérium 55 části 6: uživatel musí vidět, jak e-mail vypadá
 * pro kontakt, u kterého žádné osobní údaje nejsou. Nahradit to výběrem
 * skutečného kontaktu nejde, protože kontakt bez jména v projektu být nemusí.
 *
 * Funkce BYDLELA v `@mlain/core/templates/api/preview-data` a přestěhovala se
 * sem beze změny chování. Důvod: tentýž výpočet potřebuje editor v prohlížeči,
 * když volba „Zobrazit jako" dosazuje hodnoty rovnou do plátna, a `@mlain/core`
 * sahá na databázi, takže se do prohlížeče importovat nesmí. Druhá kopie
 * seznamu osobních polí by znamenala, že „Kontakt bez jména" znamená v editoru
 * něco jiného než v náhledu ze serveru.
 */
export function sampleFor(
  language: 'cs' | 'en',
  variant: 'default' | 'no_name',
  greeting: SampleGreetingSettings = DEFAULT_SAMPLE_GREETING,
): SampleRenderData {
  const data = sampleRenderData(language, greeting);
  if (variant === 'default') return data;
  const contact = { ...data.contact };
  for (const field of PERSONAL_FIELDS) contact[field] = '';
  // OSLOVENÍ SE ZNOVU SLOŽÍ, nezůstane prázdné. Kontaktu bez jména se v e-mailu
  // pošle neutrální „Dobrý den" bez čárky, ne díra; do 7. 8. 2026 tu zůstával
  // prázdný řetězec, takže volba „Kontakt bez jména" ukazovala na prvním řádku
  // prázdno u e-mailu, který ve skutečnosti pozdraví.
  contact.greeting = sampleGreeting(language, '', '', greeting);
  // Vlastní atributy se vyprazdňují taky: podmíněný blok nad `contact.attr.city`
  // se v téhle variantě musí chovat stejně jako u kontaktu bez vyplněných polí.
  contact.attr = Object.fromEntries(
    Object.keys((data.contact.attr as Record<string, unknown>) ?? {}).map((key) => [key, '']),
  );
  return { ...data, contact };
}
