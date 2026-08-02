import { expect, type Locator, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data';

export class CampaignPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createFromTemplateAndSegment(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/campaigns`);
    await this.page.getByRole('button', { name: 'Vytvořit kampaň' }).click();
    await this.page.getByLabel('Název kampaně').fill(CAMPAIGN.name);
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
