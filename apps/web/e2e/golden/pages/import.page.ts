import { expect, type Page } from '@playwright/test';
import { CONTACTS_CSV } from '../fixtures/test-data';

export class ImportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async importFifty(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/contacts/import`);
    await this.page.getByLabel(/Vyberte soubor/).setInputFiles(CONTACTS_CSV);
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await expect(this.page.getByText(/50 řádků/)).toBeVisible();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page.getByLabel('Jméno').selectOption({ label: 'Jméno a příjmení' });
    await this.page.getByLabel('E-mail').selectOption({ label: 'E-mail' });
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    // Krok 4 z 8.3.4: náhled musí ukázat výsledné oslovení včetně fallbacku.
    await expect(this.page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();
    await expect(this.page.getByText('Dobrý den, Jano')).toBeVisible();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();
    await this.page.getByRole('button', { name: /Naimportovat/ }).click();

    await expect(this.page.getByText(/Import dokončen/)).toBeVisible({ timeout: 60_000 });
  }
}
