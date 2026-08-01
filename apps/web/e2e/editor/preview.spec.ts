import { expect, test } from '@playwright/test';
import { editorConfigured, openEditor, SKIP_REASON } from './fixtures';

test.describe('náhled šablony', () => {
  test.skip(!editorConfigured, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Náhled' }).click();
  });

  test('tlačítko Kontakt bez jména zobrazí náhled s prázdnými osobními údaji, kritérium 55', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Kontakt bez jména' }).click();
    const frame = page.frameLocator('iframe[title="Náhled e-mailu"]');
    await expect(frame.locator('body')).not.toContainText('Jana');
  });

  test('mobilní režim zúží náhled a tmavý režim ho přebarví', async ({ page }) => {
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '700');
    await page.getByRole('radio', { name: 'Mobil' }).click();
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '375');
    await page.getByRole('switch', { name: 'Tmavý režim' }).click();
    await expect(page.getByTestId('preview-frame')).toBeVisible();
  });

  test('náhled nenačítá nic z cizích domén', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url());
    });
    await page.getByRole('radio', { name: 'Mobil' }).click();
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
  });

  test('textová verze je vidět, protože ji jinak nikdo nikdy nezkontroluje', async ({ page }) => {
    await page.getByRole('radio', { name: 'Textová verze' }).click();
    await expect(page.getByTestId('preview-text')).toBeVisible();
  });
});
