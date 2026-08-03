import { expect, type Page } from '@playwright/test';
import { CONTACTS_CSV } from '../fixtures/test-data';
import { button } from './controls';

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
    // Oddělovač se UŽ NENASTAVUJE ručně. Dřív to bylo nutné, protože průvodce
    // u souboru odděleného čárkami vybral „Středník" a přečetl nula kontaktů;
    // za tím byly tři nezávislé vady v náhledu importu. Po jejich opravě si
    // čárku vybere sám, takže test měří detekci, ne obcházku kolem ní.
    await expect(this.page.getByRole('heading', { name: /Kontrola souboru/ })).toBeVisible();
    await expect(this.page.getByText(/50 kontaktů/)).toBeVisible();
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

    // Krok 6, Průběh.
    //
    // ŽÁDNÉ tlačítko „Naimportovat" tu není a nemá být: import se spouští
    // potvrzením kroku Volby (`POST /confirm`) a šestý krok už jen ukazuje
    // postup. Dřívější znění na to tlačítko čekalo a běh na něm skončil
    // vypršením celého testu:
    //   Error: locator.click: Test timeout of 360000ms exceeded.
    //     waiting for getByRole('button', { name: /Naimportovat|Spustit import/ })
    // Přitom import v tu chvíli dávno doběhl, doslovně z logu instalace:
    //   {"mode":"worker","importId":"…","processed":50,"errorRows":0,
    //    "msg":"import finished"}
    // Objekt obrazovky se ohýbá podle produktu, ne naopak.
    await expect(this.page.getByRole('heading', { name: 'Importujeme kontakty' })).toBeVisible();

    // Hotový import odveze obrazovku na výsledek. Čeká se na nadpis výsledku,
    // ne na text v průběhu: průběh ukáže „50 z 50“ ještě dřív, než worker
    // uzavře import, a test by pokračoval nad nehotovými daty.
    await expect(this.page.getByRole('heading', { name: /Naimportováno 50 kontaktů/ })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
  }
}
