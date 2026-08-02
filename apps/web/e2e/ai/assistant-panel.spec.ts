import { expect, test } from '@playwright/test';
import { EDITOR_PATH, editorConfigured, SKIP_EDITOR_REASON, signIn } from './fixtures';

test.describe('panel asistenta v editoru', () => {
  // Vývojový server překládá stránku až při prvním otevření, takže první
  // průchod trvá déle než výchozích 30 sekund. Není to pomalá obrazovka.
  test.setTimeout(120_000);

  test.skip(!editorConfigured, SKIP_EDITOR_REASON);

  test('panel je vidět vedle editoru, ne přes něj', async ({ page }) => {
    await signIn(page);
    await page.goto(EDITOR_PATH);
    const panel = page.getByRole('complementary', { name: 'AI asistent' });
    await expect(panel).toBeVisible({ timeout: 120_000 });
    // Plátno editoru zůstává viditelné, protože uživatel musí vidět, co se mění.
    await expect(page.getByRole('tree')).toBeVisible();
    expect(await page.getByRole('dialog').count()).toBe(0);
  });

  test('bez klíče projektu panel vysvětlí, co je potřeba, a odkáže do nastavení', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(EDITOR_PATH);
    const panel = page.getByRole('complementary', { name: 'AI asistent' });
    await expect(panel).toBeVisible({ timeout: 120_000 });

    const setup = panel.getByRole('link', { name: 'Nastavit klíč' });
    // Projekt s klíčem odkaz nemá, protože není co nastavovat. Pak musí být
    // vidět formulář zadání.
    if (await setup.isVisible()) {
      await expect(panel.getByRole('alert')).toContainText(/potřebujete vlastní klíč/);
      await setup.click();
      await expect(page).toHaveURL(/\/settings\/ai$/);
    } else {
      await expect(panel.getByLabel(/Co má e-mail obsahovat/)).toBeVisible();
    }
  });
});
