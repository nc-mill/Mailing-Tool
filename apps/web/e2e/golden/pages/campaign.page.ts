import { expect, type Locator, type Page } from '@playwright/test';
import { CAMPAIGN, SMTP } from '../fixtures/test-data';
import { chooseOption } from './controls';

/**
 * Kampaň, srovnaná podle SKUTEČNÉ obrazovky kampaně.
 *
 * Kampaň má TŘI kroky a bydlí na DVOU adresách:
 *
 *   krok 1 „Obsah e-mailu"        → `/campaigns/{id}/content`, je to sám editor
 *   krok 2 „Předmět a název"      → `/campaigns/{id}?step=basics`
 *   krok 3 „Nastavení a odeslání" → `/campaigns/{id}?step=settings`
 *
 * Kroky 2 a 3 jsou dva panely JEDNOHO formuláře (`campaign-panel-basics`,
 * `campaign-panel-settings`); skrytý panel zůstává v dokumentu, takže se
 * přepnutím neztratí nic rozepsaného a jedno uložení uloží obojí.
 *
 *   krok 2, karta „Základ":      Předmět | Předhlavička
 *   krok 3, region „Publikum":   group „Seznamy" / „Segmenty" (ZAŠKRTÁVÁTKA)
 *                                group „Vynechat seznamy" / „Vynechat segmenty"
 *   krok 3, region „Odesílatel": Jméno odesílatele | E-mail odesílatele |
 *                                Adresa pro odpovědi | combobox „Odesílací účet" |
 *                                combobox „Odesílací doména"
 *   krok 3, region „Odhlášení a měření": combobox „Seznam pro odhlášení"
 *   button „Uložit kampaň" | link „Zkontrolovat a odeslat"
 *
 * Čtyři věci, na kterých stavěla dřívější znění a které NEPLATÍ:
 * 1. Publikum jsou zaškrtávátka, ne `selectOption`. Doména chce `include.lists`
 *    i `include.segments`, takže jedním výběrem by se vyjádřit nedaly.
 * 2. Kroky nejsou dva a nejsou na jedné adrese, viz výš.
 * 3. Pole „Název kampaně" v kroku 2 UŽ NENÍ: přejmenovává se v hlavičce
 *    obrazovky a ukládá se samostatnou akcí, aby ho nezastavil chybějící
 *    předmět. Zakládací obrazovka `/campaigns/new` jméno vyplní.
 * 4. Výběr „Šablona" v kroku s předmětem UŽ NENÍ: obsah se přebírá v kroku 1
 *    akcí „Převzít obsah ze šablony", nebo rovnou při zakládání kampaně.
 */
export class CampaignPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Založí kampaň a vyplní vše, co kontrolní seznam před odesláním vyžaduje.
   *
   * Zakládání začíná obsahem: zakládací obrazovka vybere, jestli e-mail
   * vznikne prázdný, nebo ze šablony, a pak se prochází kroky 2 a 3.
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
     * KROKY JSOU TŘI, ne dva, a první z nich je SÁM EDITOR na vlastní adrese
     * `/campaigns/{id}/content`. Zbylé dva, „Předmět a název" a „Nastavení
     * a odeslání", jsou dva panely jednoho formuláře na `/campaigns/{id}`
     * a přepínají se parametrem `?step=`.
     *
     * Dřívější znění počítalo se dvěma kroky, hledalo „Předmět" hned po
     * založení a vyplňovalo obsah výběrem „Šablona" v prvním kroku. Ani jedno
     * už neplatí: pole „Předmět" je v kroku 2, výběr šablony v prvním kroku
     * nahradila akce „Převzít obsah ze šablony" a pole „Název kampaně" se
     * přesunulo do hlavičky obrazovky, kde se ukládá samostatně. Běh na tom
     * skončil vypršením celého testu, protože čekal na pole ve skrytém panelu.
     */
    await this.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}(\/content)?(\?.*)?$/i);
    const campaignId = this.page.url().match(/\/campaigns\/([0-9a-f-]{36})/i)?.[1];
    if (campaignId === undefined) throw new Error('Adresa založené kampaně nemá id.');
    this.settingsUrl = `/w/${this.slug}/campaigns/${campaignId}`;

    // Krok 2: předmět. Název kampaně už nese hlavička, vyplnil ho zakládací krok.
    await this.page.getByTestId('campaign-step-basics').click();
    await expect(this.page.getByTestId('campaign-panel-basics')).toBeVisible();
    await this.page.getByLabel('Předmět', { exact: true }).fill(CAMPAIGN.subject);

    await this.page.getByTestId('campaign-step-settings').click();
    await expect(this.page.getByTestId('campaign-panel-settings')).toBeVisible();
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

  /** Adresa nastavení kampaně, zapamatovaná při jejím založení. */
  private settingsUrl: string | null = null;

  /**
   * Kontrolní seznam připravenosti, tedy druhá obrazovka kampaně.
   *
   * Nejdřív se scénář vrátí na kampaň. Mezi uložením a odesláním se do zlaté
   * cesty vklínilo přihlášení přes veřejný formulář, takže prohlížeč je jinde
   * a odkaz „Zkontrolovat a odeslat" na cizí obrazovce není.
   */
  async openSendCheck(): Promise<void> {
    if (this.settingsUrl === null) throw new Error('Kampaň ještě nebyla založena.');
    await this.page.goto(this.settingsUrl);
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

  /** Adresa průběhu odesílání, zapamatovaná při prvním příchodu na ni. */
  private progressUrl: string | null = null;

  async expectLiveProgress(): Promise<void> {
    await this.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\/progress$/i, { timeout: 60_000 });
    await expect(this.page.getByRole('heading', { name: 'Průběh odesílání' })).toBeVisible({
      timeout: 60_000,
    });
    this.progressUrl = this.page.url();
  }

  /**
   * Zpátky na průběh odesílání.
   *
   * Adresa se pamatuje, neskládá se znovu proklikáním seznamu kampaní: řádek
   * odeslané kampaně vede jinam než řádek rozepsané a scénář by tím měřil
   * navigaci místo rozesílky.
   */
  async openProgress(): Promise<void> {
    if (this.progressUrl === null) throw new Error('Kampaň ještě neodešla.');
    await this.page.goto(this.progressUrl);
    await expect(this.page.getByRole('heading', { name: 'Průběh odesílání' })).toBeVisible({
      timeout: 60_000,
    });
  }

  /**
   * Počká, až rozesílka SKONČÍ.
   *
   * Čeká se na stav, který obrazovka sama hlásí („Rozesílka skončila"), ne na
   * uplynulý čas: kampaň jede přes fronty na pozadí a pevná pauza by vyrobila
   * test, který jednou za čas spadne bez příčiny, a jindy naopak přečte čísla
   * z nedokončené rozesílky a prohlásí je za pravdu.
   */
  async waitUntilFinished(): Promise<void> {
    await expect
      .poll(
        async () => {
          await this.page.reload();
          return await this.page.getByText(/Rozesílka skončila/).count();
        },
        { timeout: 180_000, message: 'Průběh odesílání neohlásil konec rozesílky' },
      )
      .toBeGreaterThan(0);
  }

  /**
   * Počet odeslaných z dlaždice „Odesláno" na průběhu.
   *
   * Je to jediné číslo o rozesílce, které produkt ukazuje bez ohledu na to,
   * jestli od odesílací služby dorazila zpráva o osudu e-mailů. Zlatá cesta ho
   * porovnává s tím, co opravdu leží v poštovní pasti: report, který si čísla
   * čte z téže tabulky, ze které si je počítá, neodhalí sám, že se odmítnutá
   * zpráva započítala jako doručená.
   */
  async sentCount(): Promise<number> {
    const tile = this.page.getByTestId('tile-sent');
    await expect(tile).toBeVisible({ timeout: 60_000 });
    // V dlaždici je popisek, číslo a vysvětlující věta; číslice má jen to číslo.
    const text = (await tile.innerText()).replace(/\s/g, '');
    return Number(text.replace(/\D/g, '') || '0');
  }
}
