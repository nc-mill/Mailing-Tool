import { expect, type Page } from '@playwright/test';
import { CONTACTS_CSV } from '../fixtures/test-data';
import { button, chooseOption } from './controls';

export class ImportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Průvodce importem má ŠEST kroků, ne čtyři, jak počítá plán:
   * Nahrání, Kontrola souboru, Mapování, Náhled, Volby, Spuštění.
   */
  async importFifty(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/contacts/import`);

    // Krok 1, Nahrání. Plán čeká pole s popiskem „Vyberte soubor", skutečnost
    // je plocha na přetažení se skrytým `input[type=file]` bez popisku:
    //
    //   status: Krok 1 z 6
    //   heading "Nahrání"
    //   paragraph: Přetáhněte sem soubor s kontakty
    //   button "vyberte ze složky"
    //
    // `setInputFiles` na skrytý vstup funguje, viditelnost nepotřebuje.
    await this.page.locator('input[type=file]').first().setInputFiles(CONTACTS_CSV);

    // Krok 2, Kontrola souboru.
    //
    // ODDĚLOVAČ SE NASTAVUJE VÝSLOVNĚ a je to obejití vady, ne vrtoch.
    // U souboru odděleného ČÁRKAMI si průvodce vybere „Středník" a přečte
    // z něj nula kontaktů:
    //
    //   paragraph: Žádný řádek, z toho 1 hlavička, tedy žádný kontakt
    //   combobox "Oddělovač": option "Středník" [selected]
    //
    // Kdyby se to nechalo na automatice, test by od téhle chvíle měřil prázdný
    // import a všechno další by prošlo naprázdno. Zapsáno jako nález.
    await expect(this.page.getByRole('heading', { name: /Kontrola souboru/ })).toBeVisible();
    await chooseOption(this.page, 'Oddělovač', 'Čárka');
    await expect(this.page.getByText(/50/).first()).toBeVisible();
    await button(this.page, 'Pokračovat').click();

    // Krok 3, Mapování.
    //
    // Sloupec „Jméno" nese CELÉ jméno („Jana Nováková"), ale průvodce si ho sám
    // přiřadí na pole „Jméno", tedy na křestní. Pak by se jméno nerozdělilo,
    // příjmení zůstalo prázdné a vokativ by neměl z čeho vzniknout, takže by
    // padl krok 3 demo skriptu. Přemapuje se proto na „Celé jméno".
    //
    // Plán tu má `selectOption({ label: 'Jméno a příjmení' })`; skutečná
    // volba se jmenuje „Celé jméno".
    await expect(this.page.getByRole('columnheader', { name: 'Uložit jako' })).toBeVisible();
    await this.page
      .getByRole('row')
      .filter({ has: this.page.getByRole('rowheader', { name: 'Jméno', exact: true }) })
      .getByRole('combobox')
      .selectOption({ label: 'Celé jméno' });
    await button(this.page, 'Pokračovat').click();

    // Krok 4, Náhled. Jádro kroku 3 demo skriptu: rozdělení jména, rod
    // a vokativ. Sloupec „Oslovení" tu být MUSÍ.
    await expect(this.page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();
    await expect(this.page.getByText('Dobrý den, Jano').first()).toBeVisible();
    await button(this.page, 'Pokračovat').click();

    // Krok 5, Volby. Potvrzení právního důvodu je povinné, bez něj se import
    // nespustí. Plán s ním nepočítal.
    await expect(this.page.getByRole('heading', { name: /Poslední dvě otázky/ })).toBeVisible();
    await this.page.getByRole('checkbox', { name: /Potvrzuji/ }).check();
    await button(this.page, 'Pokračovat').click();

    // Krok 6, Spuštění.
    await this.page
      .getByRole('button', { name: /Naimportovat|Spustit import/ })
      .first()
      .click();
    await expect(this.page.getByText(/dokončen/).first()).toBeVisible({ timeout: 60_000 });
  }
}
