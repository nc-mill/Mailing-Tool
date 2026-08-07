import { expect, type Page } from '@playwright/test';

/**
 * Report kampaně.
 *
 * SROVNÁNO PODLE SKUTEČNÉHO PRODUKTU. Dřívější znění hledalo záložku „Report"
 * a čtyři testovací háčky (`tile-delivered`, `tile-clicked`, `tile-unsubscribed`,
 * `open-rate-caveat`, `metric-percentage-*`). V produktu není ani jeden z nich:
 *
 * 1. Report NENÍ záložka, je to vlastní adresa `/campaigns/{id}/report`
 *    a chodí se na ni odkazem „Zobrazit report kampaně" z průběhu odesílání.
 * 2. `tile-delivered` a `tile-sent` v DOM existují, jenže na obrazovce PRŮBĚHU,
 *    ne v reportu. Dlaždice reportu nesou `aria-labelledby="tile-<klíč>"`, což
 *    je ID popisku, ne `data-testid`, takže `getByTestId` je nenajde.
 * 3. `open-rate-caveat` ani `metric-percentage-*` v repozitáři nejsou vůbec.
 *
 * Objekt obrazovky se proto kotví na to, co produkt opravdu má: `headline-tiles`
 * kolem dlaždic a přístupné jméno každé z nich. Je to zároveň odolnější, protože
 * `aria-labelledby` je součást přístupnosti, ne atribut zavedený kvůli testu.
 */
export class ReportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /** Z průběhu odesílání na report, stejnou cestou jako uživatel. */
  async open(): Promise<void> {
    await this.page.getByTestId('progress-to-report').click();
    await this.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\/report$/i, { timeout: 60_000 });
    await expect(this.page.getByTestId('headline-tiles')).toBeVisible({ timeout: 90_000 });
  }

  /** Hlavní tři dlaždice podle 8.7.2: kliklo, doručeno, odhlásilo se. */
  async expectHeadlineTiles(): Promise<void> {
    for (const name of ['Kliklo', 'Doručeno', 'Odhlásilo se']) {
      await expect(this.tile(name)).toBeVisible({ timeout: 90_000 });
    }
  }

  /** Míra otevření nesmí být hlavní metrika a musí mít poznámku o nepřesnosti. */
  async expectOpenRateCaveat(): Promise<void> {
    // Otevření jsou o patro níž ve vlastním panelu, ne mezi hlavními dlaždicemi.
    await expect(this.page.getByTestId('headline-tiles')).not.toContainText('Otevř');
    await expect(
      this.page.getByText(/Část otevření vyrábějí poštovní programy samy/),
    ).toBeVisible();
  }

  /**
   * U každého procenta musí stát, z čeho se počítá.
   *
   * Procento bez jmenovatele je v reportu ta nejdražší nejasnost: „12 %"
   * z doručených a „12 %" z odeslaných jsou u kampaně s odrazy dvě různá
   * čísla. Dlaždice proto sází trojici číslo, procento, jmenovatel.
   */
  async expectDenominatorNextToEveryPercentage(): Promise<void> {
    const tiles = this.page.getByTestId('headline-tiles').getByRole('region');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const text = (await tiles.nth(i).innerText()).replace(/\s+/g, ' ');
      // Dlaždice bez měření žádné procento neukazuje, a je to správně: nula by
      // tvrdila „nikdo", ne „neměříme". Jmenovatel se tedy vyžaduje jen tam,
      // kde procento (nebo pomlčka místo něj) opravdu je.
      if (!/\d\s*%|–/.test(text)) continue;
      expect(text, `Dlaždice bez jmenovatele u procenta: ${text}`).toMatch(
        /z (doručených|odeslaných)/,
      );
    }
  }

  /**
   * Číslo z dlaždice, nebo `null`, když se metrika neměří.
   *
   * Rozdíl mezi „nula" a „nemáme z čeho počítat" je v reportu podstatný, takže
   * ho objekt obrazovky nesmí smazat na nulu. Volající se pak může rozhodnout,
   * co s tím: u SMTP účtu doručení nikdo nehlásí a `null` je poctivá odpověď.
   */
  async tileNumber(name: string): Promise<number | null> {
    const text = (await this.tile(name).innerText()).replace(/\s/g, ' ');
    // Popisek dlaždice je na prvním řádku, číslo hned pod ním. Bere se první
    // číslo ZA popiskem, aby se do něj nepřimíchalo procento ani jmenovatel.
    const rest = text.slice(text.indexOf(name) + name.length);
    // Nezměřeno se pozná podle věty, ne podle chybějící číslice: kdyby se
    // v hlášce jednou objevilo číslo, tichá záměna za nulu by byla horší než
    // pád testu.
    if (/Zatím nevíme|bylo pro tuto kampaň vypnuté/.test(rest)) return null;
    const digits = rest.match(/(\d[\d ]*)/)?.[1];
    if (digits === undefined) return null;
    return Number(digits.replace(/\D/g, ''));
  }

  private tile(name: string) {
    return this.page.getByTestId('headline-tiles').getByRole('region', { name });
  }
}
