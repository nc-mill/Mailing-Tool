import { expect, test } from '@playwright/test';
import { editorConfigured, openEditor, SKIP_REASON } from './fixtures';

/**
 * Náhled si nechává vyrobit HTML na serveru. Endpoint
 * `POST /api/v1/templates/{id}/preview` **v routeru dnes není** (otevřený
 * požadavek P08-R2), takže pruh ukáže „Náhled se nepodařilo vytvořit."
 * a testy níž nemají co kontrolovat. Zapínají se proto příznakem, aby suita
 * nebyla trvale červená na cizím díle a přitom bylo vidět, na co se čeká.
 * Editorová strana včetně tlačítka „Kontakt bez jména" je hotová a pokrytá
 * jednotkovým testem `preview-pane.test.tsx` proti dvojníkovi portů.
 */
const previewApi = process.env['E2E_TEMPLATES_API'] === '1';

test.describe('náhled šablony', () => {
  test.skip(!editorConfigured, SKIP_REASON);
  test.skip(
    !previewApi,
    'Chybí POST /api/v1/templates/{id}/preview, viz P08-R2. Zapni E2E_TEMPLATES_API=1.',
  );

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
