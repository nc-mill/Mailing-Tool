import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { stubReportApi } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

test.describe('report kampaně', () => {
  test.beforeEach(async ({ page }) => {
    await stubReportApi(page);
    await page.goto('/w/demo/campaigns/c1/report');
  });

  test('hlavní dlaždice jsou kliklo, doručeno a odhlásilo se (kritérium 57)', async ({ page }) => {
    // Hledá se uvnitř bloku dlaždic, ne na celé stránce: skořápka kolem
    // reportu má vlastní nadpisy a test by měřil ji, ne report.
    await expect(page.getByRole('heading', { name: 'Kliklo', level: 3 })).toBeVisible();
    const headings = await page.locator('#main h3').allInnerTexts();
    expect(headings).toEqual(['Kliklo', 'Doručeno', 'Odhlásilo se']);
  });

  test('u otevření je trvalá poznámka o nepřesnosti a rozpad na tři skupiny (kritérium 58)', async ({
    page,
  }) => {
    await expect(page.getByText('Spolehlivé číslo je kliknutí.')).toBeVisible();
    await expect(page.getByText('387 ověřených')).toBeVisible();
    await expect(page.getByText('411 pravděpodobně automatických')).toBeVisible();
    await expect(page.getByText('34 nejistých')).toBeVisible();
    await expect(page.getByText(/navíc kliklo na odkaz/)).toBeVisible();
  });

  test('přepínač automatických otevření je ve výchozím stavu zapnutý a mění číslo', async ({
    page,
  }) => {
    const toggle = page.getByLabel('Odečíst pravděpodobně automatická otevření');
    await expect(toggle).toBeChecked();
    await expect(page.getByText('z doručených bez Apple Mailu')).toBeVisible();
    await toggle.uncheck();
    await expect(page.getByText('Zobrazena všechna otevření')).toBeVisible();
    await expect(page).toHaveURL(/opens=all/);
  });

  test('prediktivní otevření je označené jako odhad a je to rozsah', async ({ page }) => {
    await expect(page.getByText(/odhad 560 až 640/)).toBeVisible();
  });

  test('u každého procenta je jmenovatel (kritérium 59)', async ({ page }) => {
    await expect(page.getByText('z doručených').first()).toBeVisible();
    await expect(page.getByText('z odeslaných').first()).toBeVisible();
  });

  test('seznam příjemců unese smazaný kontakt', async ({ page }) => {
    await expect(page.getByText('Smazaný kontakt')).toBeVisible();
    await expect(page.getByText('Jana Nováková')).toBeVisible();
  });

  test('obrazovka nemá vážné prohřešky proti přístupnosti', async ({ page }) => {
    // Měří se obsah reportu (`#main`), ne skořápka kolem něj. Skořápku vlastní
    // P05 a její vlastní nálezy (například `aria-label` na `div` bez role
    // v toastech a chybějící `lang` na `html`) patří do jejího testu, ne sem.
    const results = await new AxeBuilder({ page })
      .include('#main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
  });
});
