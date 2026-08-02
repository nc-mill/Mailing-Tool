import { expect, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data';

export class SegmentPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createActiveNinetyDays(): Promise<number> {
    await this.page.goto(`/w/${this.slug}/contacts/segments`);
    await this.page.getByRole('button', { name: 'Postavit vlastní segment' }).click();
    await this.page.getByLabel('Název segmentu').fill(CAMPAIGN.segmentName);
    await this.page.getByRole('button', { name: 'Přidat podmínku' }).click();
    await this.page.getByLabel('Pole').selectOption({ label: 'Přidán' });
    await this.page.getByLabel('Podmínka').selectOption({ label: 'za posledních N dní' });
    await this.page.getByLabel('Hodnota').fill('90');

    const count = this.page.getByTestId('segment-live-count');
    await expect(count).toBeVisible();
    await expect(count).not.toHaveText('');
    const text = (await count.textContent()) ?? '0';

    await this.page.getByRole('button', { name: 'Uložit segment' }).click();
    await expect(this.page.getByText(/Segment uložen/)).toBeVisible();
    return Number(text.replace(/\D/g, ''));
  }
}
