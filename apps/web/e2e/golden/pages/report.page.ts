import { expect, type Page } from '@playwright/test';

export class ReportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async open(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Report' }).click();
  }

  /** Hlavní tři dlaždice podle 8.7.2: doručeno, kliklo, odhlásilo se. */
  async expectHeadlineTiles(): Promise<void> {
    await expect(this.page.getByTestId('tile-delivered')).toBeVisible({ timeout: 90_000 });
    await expect(this.page.getByTestId('tile-clicked')).toBeVisible();
    await expect(this.page.getByTestId('tile-unsubscribed')).toBeVisible();
  }

  /** Míra otevření nesmí být hlavní metrika a musí mít poznámku o nepřesnosti. */
  async expectOpenRateCaveat(): Promise<void> {
    await expect(this.page.getByTestId('open-rate-caveat')).toBeVisible();
  }

  async expectDenominatorNextToEveryPercentage(): Promise<void> {
    const percentages = this.page.getByTestId(/^metric-percentage-/);
    const count = await percentages.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(percentages.nth(i)).toHaveAttribute('data-basis', /\S/);
    }
  }
}
