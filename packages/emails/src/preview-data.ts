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
export function sampleRenderData(language: 'cs' | 'en'): SampleRenderData {
  const cs = language === 'cs';
  return {
    contact: {
      email: 'jan.novak@example.com',
      first_name: cs ? 'Přemyslav-Řehoř' : 'Zoë',
      last_name: '',
      first_name_vocative: cs ? 'Přemyslave-Řehoři' : 'Zoë',
      last_name_vocative: '',
      title_prefix: 'Ing.',
      title_suffix: '',
      greeting: cs ? 'Dobrý den, Přemyslave-Řehoři' : 'Hello Zoë',
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
export function sampleFor(language: 'cs' | 'en', variant: 'default' | 'no_name'): SampleRenderData {
  const data = sampleRenderData(language);
  if (variant === 'default') return data;
  const contact = { ...data.contact };
  for (const field of PERSONAL_FIELDS) contact[field] = '';
  // Vlastní atributy se vyprazdňují taky: podmíněný blok nad `contact.attr.city`
  // se v téhle variantě musí chovat stejně jako u kontaktu bez vyplněných polí.
  contact.attr = Object.fromEntries(
    Object.keys((data.contact.attr as Record<string, unknown>) ?? {}).map((key) => [key, '']),
  );
  return { ...data, contact };
}
