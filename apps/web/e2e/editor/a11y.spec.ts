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
    expect(results.violations).toEqual([]);
  });

  test('panel vlastností má popisky u všech polí', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('tree').press('Tab');
    await page.keyboard.press('ArrowDown');
    const results = await new AxeBuilder({ page }).include('#editor-properties').analyze();
    expect(results.violations).toEqual([]);
  });
});
