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
