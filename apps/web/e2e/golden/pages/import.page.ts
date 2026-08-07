import { expect, type Page } from '@playwright/test';
import { CONTACTS_CSV, SUBSCRIBERS_LIST } from '../fixtures/test-data';
import { button, chooseRadio } from './controls';

export class ImportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Vybere cílový seznam, a když v nabídce není, založí ho rovnou v kroku.
   *
   * Obě větve jsou skutečné cesty produktu, ne obcházka. Krok Volby nabízí
   * vedle výběru i pole „Název nového seznamu" s tlačítkem „Založit seznam",
   * právě proto, že projekt seznam mít nemusí: první projekt instalace ho
   * nedostane vůbec (nález v oddílu 4 STAV-UKOLU). Scénář, který by seznam
   * jen vybíral, by se na takovém projektu zasekl na prázdné nabídce.
   */
  private async chooseOrCreateList(): Promise<void> {
    const select = this.page.getByLabel('Zařadit do seznamu');
    await expect(select).toBeVisible();
    await select.click();

    const option = this.page.getByRole('option', { name: SUBSCRIBERS_LIST });
    if ((await option.count()) > 0) {
      await option.first().click();
      return;
    }

    // Nabídka je prázdná. Zavře se a seznam se založí polem vedle ní; průvodce
    // ho pak sám vybere.
    await this.page.keyboard.press('Escape');
    await this.page.getByLabel('Název nového seznamu').fill(SUBSCRIBERS_LIST);
    await this.page.getByRole('button', { name: 'Založit seznam' }).click();
    await expect(this.page.getByLabel('Zařadit do seznamu')).toContainText(SUBSCRIBERS_LIST, {
      timeout: 30_000,
    });
  }

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
    //
    // Nadpisem kroku UŽ NENÍ jeho jméno. Průvodce má jediný nadpis stránky
    // („Import kontaktů") a jméno kroku hlásí živá oblast „Krok 2 z 6 ·
    // Kontrola souboru"; vlastní nadpis kroku je otázka, na kterou se ptá.
    // Dřívější znění čekalo `heading /Kontrola souboru/` a od přestavby
    // průvodce padalo hned na něm, přestože obrazovka byla v pořádku.
    await expect(
      this.page.getByRole('heading', { name: /Zkontrolujte, jestli soubor čteme správně/ }),
    ).toBeVisible();
    await expect(this.page.getByText(/50 kontaktů/)).toBeVisible();
    // Průvodce má vlastní navigaci se stejně pojmenovaným tlačítkem, ale až ZA
    // obsahem kroku, takže `first()` je to krokové.
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
    // Tlačítko kroku mapování se jmenuje podle toho, co udělá, ne „Pokračovat".
    await button(this.page, 'Zobrazit náhled').click();

    // Krok 4, Náhled. Jádro kroku 3 demo skriptu: rozdělení jména, rod
    // a vokativ. Sloupec „Oslovení" tu být MUSÍ.
    await expect(this.page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();
    await expect(this.page.getByText('Dobrý den, Jano').first()).toBeVisible();
    await button(this.page, 'Pokračovat').click();

    // Krok 5, Volby. Potvrzení právního důvodu je povinné, bez něj se import
    // nespustí. Plán s ním nepočítal.
    //
    // Otázky jsou TŘI, ne dvě, a import se spouští tlačítkem s počtem
    // („Naimportovat 50 kontaktů"), ne obecným „Pokračovat". Obojí se v kroku
    // změnilo; test se řídí produktem.
    await expect(this.page.getByRole('heading', { name: /Poslední tři otázky/ })).toBeVisible();

    /*
     * CÍLOVÝ SEZNAM JE POVINNÝ. Bez něj krok nepustí dál a odpoví
     *   „Vyberte seznam, do kterého kontakty patří, nebo rovnou založte nový."
     * Je to změna z 7. 8. a dává smysl: kontakt bez seznamu nemá co dostat
     * a nemá se z čeho odhlásit. Míří se do TÉHOŽ seznamu, do kterého vede
     * veřejný formulář, aby publikum kampaně i odhlašovací odkaz mluvily
     * o jedné a téže skupině lidí.
     */
    await this.chooseOrCreateList();

    /*
     * Stav přihlášení je „Potvrzené", ne výchozí „Čeká na potvrzení".
     *
     * Import je cesta pro adresy, u kterých souhlas UŽ MÁM, a právě to
     * potvrzuje prohlášení o právním důvodu o kus níž. S výchozí volbou by
     * padesát kontaktů skončilo jako nepotvrzené, kampaň by jim neodešla
     * a zlatá cesta by od tohohle kroku měřila prázdné publikum.
     */
    await chooseRadio(this.page, 'Potvrzené');

    await this.page.getByRole('checkbox', { name: /Potvrzuji/ }).check();
    await button(this.page, /^Naimportovat \d+ kontakt/).click();

    // Krok 6, Průběh.
    //
    // Šestý krok NIC NESPOUŠTÍ a žádné tlačítko nemá, jen ukazuje postup:
    // import se rozjede potvrzením kroku Volby (`POST /confirm`). Dřívější
    // znění tady na tlačítko čekalo a běh na něm skončil vypršením celého
    // testu:
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
