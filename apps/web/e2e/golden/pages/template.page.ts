import { expect, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data';

export class TemplatePage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createFromStarter(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/templates`);
    await this.page.getByRole('button', { name: 'Vytvořit šablonu' }).click();
    await this.page.getByRole('button', { name: /Univerzální základní/ }).click();
    await this.page.getByLabel('Název šablony').fill(CAMPAIGN.templateName);
    await this.page.getByLabel('Předmět').fill(CAMPAIGN.subject);
    await this.page.getByRole('button', { name: 'Uložit' }).click();
    await expect(this.page.getByText(/Šablona uložena/)).toBeVisible();
  }
}
