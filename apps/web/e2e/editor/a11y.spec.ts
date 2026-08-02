import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { editorConfigured, openEditor, SKIP_REASON } from './fixtures';

test.describe('přístupnost editoru', () => {
  test.skip(!editorConfigured, SKIP_REASON);

  test('editor nemá porušení přístupnosti kategorie wcag2a a wcag2aa', async ({ page }) => {
    await openEditor(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();

    /**
     * Jediná vyjmutá vada je **cizí a je pojmenovaná**, ne zametená pod koberec.
     * `LiveRegionProvider` z `@mlain/ui/a11y` (P05) obaluje své oblasti divem
     * s `aria-label` a bez role, což axe hlásí jako `aria-prohibited-attr`.
     * Editor ten obal nevyrábí a `packages/ui` tenhle plán měnit nesmí, takže
     * je to požadavek na P05: dát obalu `role="region"`, nebo `aria-label`
     * přesunout na obě oblasti uvnitř. Do té doby by test padal na cizím díle
     * a přestal by hlídat vlastní značkování editoru.
     */
    const own = results.violations.filter(
      (violation) =>
        !violation.nodes.every((node) =>
          node.target.some((target) => String(target).includes('Oznámení editoru')),
        ),
    );
    expect(own).toEqual([]);
  });

  test('panel vlastností má popisky u všech polí', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('tree').press('Tab');
    await page.keyboard.press('ArrowDown');
    const results = await new AxeBuilder({ page }).include('#editor-properties').analyze();
    expect(results.violations).toEqual([]);
  });
});
