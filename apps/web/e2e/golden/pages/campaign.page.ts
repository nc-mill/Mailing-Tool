import { expect, type Locator, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data';

export class CampaignPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * OTEVŘENÝ NÁLEZ: obrazovka nastavení kampaně v aplikaci NEEXISTUJE.
   *
   * „Vytvořit kampaň" založí kampaň a rovnou přejde na `/campaigns/{id}/send`,
   * tedy na kontrolní seznam připravenosti. Ten správně hlásí, co chybí:
   *
   *   Publikum je prázdné. Vyberte alespoň jeden seznam nebo segment.
   *   Předmět je prázdný.
   *   Šablona ještě není zkompilovaná.
   *   Odesílací účet není připravený.
   *
   * Jenže první tři z těch čtyř věcí **nejde z rozhraní vyplnit**: pod
   * `campaigns/[id]/` jsou jen `progress`, `report` a `send`, a `/campaigns/{id}`
   * samotné vrací 404, ověřeno v prohlížeči. API přitom hotové je,
   * `PATCH /api/v1/campaigns/{id}` v dokumentu figuruje. Je to táž třída jako
   * chybějící API šablon, jen obráceně: tady chybí obrazovka nad hotovým API.
   *
   * Dokud obrazovka nevznikne, tenhle krok projít nemůže. Padá proto HNED
   * a s vysvětlením, místo aby šest minut čekal na pole, které neexistuje.
   */
  async createFromTemplateAndSegment(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/campaigns`);
    await this.page.getByRole('button', { name: 'Vytvořit kampaň' }).first().click();

    const nameField = this.page.getByLabel('Název kampaně');
    if ((await nameField.count()) === 0) {
      throw new Error(
        'Kampaň se založila, ale obrazovka jejího nastavení neexistuje: pod ' +
          '`campaigns/[id]/` jsou jen progress, report a send, a `/campaigns/{id}` ' +
          'vrací 404. Název, publikum, předmět ani šablonu tedy nejde vyplnit, ' +
          'přestože `PATCH /api/v1/campaigns/{id}` existuje. Chybí obrazovka nad ' +
          'hotovým API, oprava patří do P13.',
      );
    }

    await nameField.fill(CAMPAIGN.name);
    await this.page.getByLabel('Šablona').selectOption({ label: CAMPAIGN.templateName });
    await this.page.getByRole('tab', { name: 'Publikum' }).click();
    await this.page.getByLabel('Segment').selectOption({ label: CAMPAIGN.segmentName });
  }

  get trialModeNotice(): Locator {
    return this.page.getByTestId('trial-mode-audience-notice');
  }

  async sendTestTo(email: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Poslat test' }).click();
    await this.page.getByLabel('E-mail').fill(email);
    await this.page.getByRole('button', { name: 'Odeslat' }).click();
    await expect(this.page.getByText(/Testovací e-mail odešel/)).toBeVisible();
  }

  async send(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Příprava' }).click();
    const button = this.page.getByRole('button', { name: /^Odeslat \d/ });
    await expect(button).toBeVisible();
    await button.click();
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /Odeslat/ })
      .click();
  }

  async expectLiveProgress(): Promise<void> {
    await expect(this.page.getByTestId('campaign-progress')).toBeVisible({ timeout: 60_000 });
  }
}
