import { expect, type Locator, type Page } from '@playwright/test';
import { CAMPAIGN, SMTP } from '../fixtures/test-data';
import { chooseOption } from './controls';

/**
 * Kampaň, srovnaná podle SKUTEČNÉ obrazovky kampaně.
 *
 * Obrazovka `/campaigns/{id}` je JEDEN formulář ve DVOU krocích, mezi kterými
 * se přepíná přepínačem nad ním. Otevřená kampaň začíná krokem obsahu.
 * Doslovný ARIA snapshot z běžící instalace:
 *
 *   status "Krok 1 z 2" | heading <název kampaně>
 *   navigation "Kroky kampaně": button "1 Obsah e-mailu" | "2 Nastavení a odeslání"
 *   krok 1, region "Základ": Název kampaně | Předmět | Předhlavička
 *   krok 1, region "Obsah":  combobox "Šablona" | link "Upravit obsah v editoru"
 *   krok 2, region "Publikum":   group "Seznamy" / group "Segmenty" (ZAŠKRTÁVÁTKA)
 *                                group "Vynechat seznamy" / "Vynechat segmenty"
 *   krok 2, region "Odesílatel": Jméno odesílatele | E-mail odesílatele |
 *                                Adresa pro odpovědi | combobox "Odesílací účet" |
 *                                combobox "Odesílací doména"
 *   krok 2, region "Odhlášení a měření": combobox "Seznam pro odhlášení" | dvě zaškrtávátka
 *   button "Uložit kampaň" | link "Zkontrolovat a odeslat" (v obou krocích)
 *
 * Tři věci, na kterých plán stavěl a které NEPLATÍ:
 * 1. Publikum jsou zaškrtávátka, ne `selectOption`. Doména chce `include.lists`
 *    i `include.segments`, takže jedním výběrem by se vyjádřit nedaly.
 * 2. Kroky nejsou dvě adresy: skrytý krok zůstává v dokumentu, takže se
 *    přepnutím neztratí nic rozepsaného a jedno uložení uloží obojí.
 * 3. Testovací odeslání na kampani NENÍ. Produkt ho nabízí v editoru šablony
 *    („Poslat test"), proto je i tady, viz `TemplatePage.sendTestTo`.
 */
export class CampaignPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Založí kampaň a vyplní vše, co kontrolní seznam před odesláním vyžaduje.
   *
   * Zakládání je DVOUKROKOVÉ a začíná obsahem: první krok vybere, jestli e-mail
   * vznikne prázdný, nebo ze šablony, a teprve druhý krok je nastavení kampaně.
   * Tenhle průchod jde cestou šablony; prázdný e-mail by skončil v editoru,
   * což je jiný scénář (viz `TemplatePage`).
   */
  async createFromTemplateAndSegment(templateName: string): Promise<void> {
    await this.page.goto(`/w/${this.slug}/campaigns`);
    await this.page.getByRole('button', { name: 'Vytvořit kampaň' }).first().click();

    await this.page.waitForURL(/\/campaigns\/new$/i);
    await expect(this.page.getByRole('heading', { name: 'Obsah e-mailu' })).toBeVisible();
    await this.page.getByLabel('Název kampaně').fill(CAMPAIGN.name);
    await this.page.getByTestId('campaign-source-template').click();
    await this.page.getByLabel(templateName, { exact: true }).click();
    await this.page.getByTestId('new-campaign-continue').click();

    /*
     * Založená kampaň se otevírá KROKEM OBSAHU, ne nastavením. Nejdřív se proto
     * vyplní to, co v prvním kroku je, a teprve pak se přepne na druhý krok.
     */
    await this.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}/i);
    await expect(this.page.getByRole('heading', { name: CAMPAIGN.name })).toBeVisible();

    await this.page.getByLabel('Název kampaně').fill(CAMPAIGN.name);
    await this.page.getByLabel('Předmět').fill(CAMPAIGN.subject);
    await chooseOption(this.page, 'Šablona', templateName);

    await this.page.getByTestId('campaign-step-settings').click();
    await this.page.getByLabel('Jméno odesílatele').fill(CAMPAIGN.fromName);
    await this.page.getByLabel('E-mail odesílatele').fill(SMTP.fromAddress);
    await chooseOption(this.page, 'Odesílací účet', SMTP.accountName);

    // Publikum: zaškrtávátko uvnitř oddílu „Publikum". Kotví se přes testid,
    // protože „Koho vynechat" má o kus níž zaškrtávátka se stejnými názvy
    // seznamů a segmentů, jen s předponou „Vynechat".
    const segmentBox = this.page
      .getByTestId('audience-include')
      .getByRole('checkbox', { name: CAMPAIGN.segmentName });
    if ((await segmentBox.count()) === 0) {
      // Rychlé selhání místo šestiminutového čekání: nabídka publika ukazuje
      // jen segmenty, které v projektu opravdu jsou.
      const nabidka = await this.page.getByTestId('audience-include').innerText();
      throw new Error(
        `Segment „${CAMPAIGN.segmentName}" v nabídce publika není. Scénář ho musí ` +
          `nejdřív založit (viz SegmentPage). Nabídka obsahuje:\n${nabidka}`,
      );
    }
    await segmentBox.check();

    await this.page.getByRole('button', { name: 'Uložit kampaň' }).click();
    await expect(this.page.getByTestId('settings-saved')).toBeVisible();
  }

  /** Kontrolní seznam připravenosti, tedy druhá obrazovka kampaně. */
  async openSendCheck(): Promise<void> {
    await this.page.getByRole('link', { name: 'Zkontrolovat a odeslat' }).click();
    await expect(this.page.getByRole('heading', { name: 'Připravenost k odeslání' })).toBeVisible();
  }

  /** Pruh se zkušebním režimem podle 8.2.9. Žije na kontrolním seznamu. */
  get trialModeNotice(): Locator {
    return this.page.getByTestId('trial-mode-audience-notice');
  }

  /**
   * Odeslání z kontrolního seznamu.
   *
   * Popisek tlačítka nese počet příjemců („Odeslat 16 e-mailů"), takže se hledá
   * vzorem. Potvrzení je `ConfirmDialog` z design systému se stejným popiskem
   * u potvrzovacího tlačítka.
   */
  async send(): Promise<void> {
    const send = this.page.getByRole('button', { name: /^Odeslat \d+ e-mail/ });
    await expect(send).toBeVisible();
    await send.click();

    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /^Odeslat \d+ e-mail/ })
      .click();
  }

  async expectLiveProgress(): Promise<void> {
    await this.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\/progress$/i, { timeout: 60_000 });
    await expect(this.page.getByRole('heading', { name: 'Průběh odesílání' })).toBeVisible({
      timeout: 60_000,
    });
  }
}
