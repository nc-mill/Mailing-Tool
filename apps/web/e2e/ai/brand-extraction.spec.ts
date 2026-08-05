import { expect, test } from '@playwright/test';
import { aiConfigured, brandSettingsPath, SKIP_REASON, signIn } from './fixtures';

test.describe('extrakce značky', () => {
  // Vývojový server překládá stránku až při prvním otevření, takže první
  // průchod trvá déle než výchozích 30 sekund. Není to pomalá obrazovka.
  test.setTimeout(120_000);

  test.skip(!aiConfigured, SKIP_REASON);

  test('vnitřní adresa dostane obecnou hlášku bez vysvětlení proč', async ({ page }) => {
    await signIn(page);
    await page.goto(brandSettingsPath());
    await page.getByPlaceholder('https://kolo-shop.cz').fill('http://169.254.169.254/');
    await page.getByRole('button', { name: 'Stáhnout' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).not.toContainText(/vnitřní|SSRF|metadata/i);
  });

  test('odpověď API nikdy nenese IP adresu cílového serveru', async ({ page, request }) => {
    await signIn(page);
    await page.goto(brandSettingsPath());
    const response = await request.post('/api/v1/brand/extractions', {
      data: { url: 'http://169.254.169.254/' },
      failOnStatusCode: false,
    });
    const body = await response.text();
    expect(body).not.toMatch(/169\.254\.169\.254/);
    expect(body).not.toMatch(/ECONNREFUSED|ETIMEDOUT/);
  });

  test('poznámka o písmech je vidět, aby uživatel nečekal firemní font', async ({ page }) => {
    await signIn(page);
    await page.goto(brandSettingsPath());
    // Poznámka je od 4. 8. 2026 SOUČÁSTÍ FORMULÁŘE značky, ne kontroly výsledku
    // extrakce, takže je vidět vždycky. Dřív visela na sekci `brand-review`,
    // kterou obrazovka ukazovala jen s uloženým profilem: projekt bez značky
    // se tedy o omezení písem nedozvěděl, přestože si ho zrovna nastavuje.
    await expect(
      page.getByText(/Vaše firemní písmo se v e-mailu spolehlivě nezobrazí/),
    ).toBeVisible();
  });
});
