import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SECTIONS = [
  'section-primitives',
  'section-k1',
  'section-k2',
  'section-k3',
  'section-k4',
  'section-k5',
  'section-k6',
  'section-k7',
  'section-k8',
  'section-states',
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} režim`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/ui-gallery');
      // Tmavý režim se kontroluje zvlášť, protože se na něj běžně zapomíná.
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
    });

    for (const section of SECTIONS) {
      test(`${section} nemá porušení WCAG 2.2 AA`, async ({ page }) => {
        const builder = new AxeBuilder({ page })
          .include(`#${section}`)
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);

        // Odchylka od plánu: K6 vykresluje iframe s `sandbox=""` (bez jediné
        // výjimky, viz K6 v packages/ui). Axe se do takového rámce (žádné
        // skriptování, žádný stejný původ) nemůže vstříknout a podle vlastního
        // návodu na chyby (odkaz v hlášené chybě) tím spadne celý kontext
        // prohlížeče. Obsah uvnitř rámce je statická ukázka bez interaktivních
        // prvků, popisek nese `title` na `<iframe>` samotném, který se
        // kontroluje na úrovni rodičovského dokumentu. Zbytek sekce K6
        // (přepínače šířky a režimu, věta o blokovaných zdrojích) se kontroluje beze změny.
        if (section === 'section-k6') builder.exclude(`#${section} iframe`);

        const results = await builder.analyze();

        expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual(
          [],
        );
      });
    }
  });
}

test('dialog má focus trap a zavírá se Escapem', async ({ page }) => {
  await page.goto('/ui-gallery');
  await page
    .getByRole('button', { name: /Smazat/ })
    .first()
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fokus nesmí uniknout z dialogu ven.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(inside).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
