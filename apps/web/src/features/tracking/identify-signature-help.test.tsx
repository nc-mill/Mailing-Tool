// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csTracking from '../../../../../packages/i18n/messages/cs/tracking.json';
import enTracking from '../../../../../packages/i18n/messages/en/tracking.json';
import { IdentifySignatureHelp } from './identify-signature-help';

/**
 * NÁPOVĚDA K PODPISU V OBOU JAZYCÍCH.
 *
 * Katalogy `cs` a `en` u téhle obrazovky seděly klíč po klíči, a přesto byla
 * anglická verze rozbitá: vzorec a všechny tři bloky kódu byly napsané
 * v komponentě natvrdo česky, takže se překladem projít nemohly. Anglicky
 * mluvící zákazník viděl přeložené nadpisy a pod nimi české komentáře, tedy
 * právě tu část, kvůli které na obrazovku chodí. Porovnání katalogů to
 * odhalit NEMOHLO, protože v katalogu ty texty vůbec nebyly.
 *
 * Test proto obrazovku vykreslí a dívá se na vykreslený text, ne na klíče.
 */

function renderHelp(locale: 'cs' | 'en') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ tracking: locale === 'cs' ? csTracking : enTracking }}
      timeZone="Europe/Prague"
    >
      <IdentifySignatureHelp />
    </NextIntlClientProvider>,
  );
}

/** Česká slova, která v komponentě zbyla natvrdo a do angličtiny prosakovala. */
const CESKA_SLOVA = [
  'bez_vyplne',
  'sekret klíče',
  'privátní klíč',
  'Podepisuje se',
  'Kanonizace',
  'Spojovníkem',
  'doplňovacích',
  'podpisZeServeru',
  'prohlížeči',
];

describe('IdentifySignatureHelp', () => {
  it('v angličtině neukáže ani jedno české slovo', () => {
    const { container } = renderHelp('en');
    const text = container.textContent ?? '';
    for (const slovo of CESKA_SLOVA) {
      expect(text, `v anglické verzi zůstalo "${slovo}"`).not.toContain(slovo);
    }
  });

  it('v angličtině ukáže anglické vysvětlení podepsaného volání', () => {
    renderHelp('en');
    expect(screen.getByText(/Only a signed call may pass an email or phone/)).toBeInTheDocument();
    expect(screen.getByText('What exactly is signed')).toBeInTheDocument();
  });

  it('v češtině ukáže české vysvětlení', () => {
    renderHelp('cs');
    expect(screen.getByText(/Teprve podepsané volání smí předat e-mail/)).toBeInTheDocument();
  });

  /**
   * Kód, který se má zkopírovat a spustit, musí být v obou jazycích ZNAKU PO
   * ZNAKU týž. Jinak pošle zákazník do hlášení chyby jiný text podle toho,
   * jaký měl zapnutý jazyk rozhraní, a rozdíl v podepisovaném řetězci vznikne
   * až v překladu.
   */
  it('bloky kódu jsou v obou jazycích totožné', () => {
    const cs = renderHelp('cs');
    const csKod = [...cs.container.querySelectorAll('pre')].map((el) => el.textContent);
    cs.unmount();

    const en = renderHelp('en');
    const enKod = [...en.container.querySelectorAll('pre')].map((el) => el.textContent);

    expect(csKod.length).toBeGreaterThanOrEqual(4);
    expect(enKod).toEqual(csKod);
  });

  /**
   * Sekret je čtvrtá část klíče a sám obsahuje podtržítka, takže dělení podle
   * POSLEDNÍHO podtržítka utne jen jeho konec a podpis se nikdy netrefí.
   * Návod na tom jednou padl, tak ať se to nevrátí kopií z paměti.
   */
  it('příklady dělí klíč podle třetího podtržítka, ne podle posledního', () => {
    const { container } = renderHelp('en');
    const text = container.textContent ?? '';
    expect(text).toContain("explode('_', $apiKey, 4)[3]");
    expect(text).toContain('api_key.split("_", 3)[3]');
  });
});
