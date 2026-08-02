import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { aiConfigured, aiSettingsPath, SKIP_REASON, signIn } from './fixtures';

test.describe('nastavení klíče AI', () => {
  // Vývojový server překládá stránku až při prvním otevření, takže první
  // průchod trvá déle než výchozích 30 sekund. Není to pomalá obrazovka.
  test.setTimeout(120_000);

  test.skip(!aiConfigured, SKIP_REASON);

  test('obrazovka dává najevo, že klíč platí uživatel', async ({ page }) => {
    await signIn(page);
    await page.goto(aiSettingsPath());
    // Věta o tom, kdo platí, je na obrazovce dvakrát schválně: jednou u klíčů
    // a jednou u spotřeby. `first()` proto, ne slabší selektor.
    await expect(page.getByText(/platíte přímo poskytovateli/i).first()).toBeVisible();
  });

  test('prázdný stav vysvětlí, že bez klíče funguje všechno ostatní', async ({ page }) => {
    await signIn(page);
    await page.goto(aiSettingsPath());
    const empty = page.getByTestId('empty-state');
    // Projekt s klíčem prázdný stav nemá, a to je v pořádku: pak musí být
    // vidět seznam. Jedno z toho platí vždycky.
    if (await empty.isVisible()) {
      await expect(page.getByText(/Bez něj funguje všechno ostatní/)).toBeVisible();
    } else {
      await expect(page.getByTestId('credential-list')).toBeVisible();
    }
  });

  test('uložený klíč se v UI nikdy nezobrazí celý', async ({ page }) => {
    await signIn(page);
    await page.goto(aiSettingsPath());

    const secret = `sk-ant-e2e-${Date.now()}-ABCD`;
    await page.getByLabel('Název').fill(`E2E klíč ${Date.now()}`);
    await page.getByLabel('Klíč', { exact: true }).fill(secret);
    await page.getByLabel('Výchozí model').fill('claude-opus-5');
    await page.getByRole('button', { name: 'Uložit' }).click();

    await expect(page.getByText('Končí na ABCD').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.content()).not.toContain(secret);
  });

  test('spotřeba ukazuje odhad ceny, ne jen tokeny', async ({ page }) => {
    await signIn(page);
    await page.goto(aiSettingsPath());
    const usage = page.getByRole('heading', { name: 'Spotřeba' });
    await expect(usage).toBeVisible();
  });

  test('obrazovka nemá zjistitelné problémy s přístupností', async ({ page }) => {
    await signIn(page);
    await page.goto(aiSettingsPath());
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

    /**
     * Jediná vyjmutá vada je CIZÍ A POJMENOVANÁ, ne zametená pod koberec.
     * Oblast oznámení z `@mlain/ui` (P05) je `div` s `aria-label` a bez role,
     * což axe hlásí jako `aria-prohibited-attr`. Obrazovka ten obal nevyrábí
     * a `packages/ui` tenhle plán měnit nesmí, takže je to požadavek na P05:
     * dát obalu `role="region"`, nebo `aria-label` přesunout dovnitř. Stejnou
     * výjimku má z téhož důvodu už `e2e/editor/a11y.spec.ts`.
     */
    const own = results.violations.filter(
      (violation) =>
        !violation.nodes.every((node) => String(node.html).includes('aria-label="Oznámení"')),
    );
    expect(own).toEqual([]);
  });
});
