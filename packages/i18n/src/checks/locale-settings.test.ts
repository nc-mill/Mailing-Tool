import { describe, expect, it } from 'vitest';
import { loadMessages } from '../load-messages';

/**
 * Vada z živé instalace: zadavatel si přepnul „Jazyk projektu" v Nastavení
 * a čekal, že se přepne celé rozhraní. Přepínače jsou dva, míří jinam a
 * nápověda u toho projektového si to plete ještě víc:
 *
 *  - `settings.general.locale` (`workspaces.locale`) řídí veřejné stránky
 *    pro příjemce a výchozí jazyk nově zakládaných kontaktů,
 *  - `settings.profile.identity.locale` (`users.locale`) řídí rozhraní,
 *    přes cookie `NEXT_LOCALE` a prefix v adrese.
 *
 * Nápověda navíc slibovala jazyk systémových e-mailů, jenže ten se z projektu
 * nebere ANI JEDNOU: obnova a změna hesla jedou podle `users.locale`, pozvánka
 * a konec zkušebního režimu podle `DEFAULT_LOCALE` instalace a potvrzení odběru
 * podle `contacts.locale`. Jazyk projektu se do e-mailu dostane nanejvýš
 * oklikou, protože ho podědí nově zakládaný kontakt.
 *
 * Test hlídá JEDINOU věc: že se systémové e-maily do té nápovědy nevrátí.
 *
 * Schválně nekontroluje, jak je věta formulovaná, ani co je v popisku odkazu.
 * Text se bude přepisovat a test, který lpí na slovech, příští člověk smaže
 * místo aby přemýšlel, proč padá. Že odkaz vede na adresu profilu, hlídá
 * `general-form.test.tsx` v `apps/web`, a to na `href`, ne na textu.
 *
 * Zbývající riziko planého poplachu je popření („systémových e-mailů se to
 * netýká"). Do nápovědy nepatří, tak se s ním nepočítá; kdyby ho tam někdo
 * chtěl, ať test smaže vědomě.
 */

const FORBIDDEN = {
  cs: ['systémových e-mailů', 'systémové e-maily'],
  en: ['system emails', 'system e-mails'],
} as const;

type Catalog = { settings: { general: { localeHint: string } } };

describe('nápověda u jazyka projektu', () => {
  for (const locale of ['cs', 'en'] as const) {
    it(`nezmiňuje systémové e-maily, protože ty se jazykem projektu neřídí (${locale})`, async () => {
      const catalog = (await loadMessages(locale)) as Catalog;
      const text = catalog.settings.general.localeHint.toLowerCase();
      for (const phrase of FORBIDDEN[locale]) {
        expect(text, `nápověda ${locale} zase zmiňuje „${phrase}"`).not.toContain(phrase);
      }
    });
  }
});
