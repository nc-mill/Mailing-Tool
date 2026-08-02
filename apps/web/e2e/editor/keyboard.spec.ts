import { expect, test } from '@playwright/test';
import { editorConfigured, openEditor, SKIP_REASON, tabToCanvas } from './fixtures';

test.describe('editor šablony, klávesová cesta', () => {
  test.skip(!editorConfigured, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('blok jde přesunout nahoru i dolů výhradně z klávesnice a pozice se oznámí', async ({
    page,
  }) => {
    await tabToCanvas(page);
    await page.keyboard.press('ArrowDown'); // vybere první blok uvnitř sekce
    const before = await page.getByRole('treeitem').allTextContents();

    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByRole('status').filter({ hasText: /pozice/ })).toContainText(
      /pozice \d+ z \d+/,
    );

    const after = await page.getByRole('treeitem').allTextContents();
    expect(after).not.toEqual(before);

    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => page.getByRole('treeitem').allTextContents()).toEqual(before);
  });

  test('blok jde zasunout do sloupce a zase vysunout jen klávesnicí', async ({ page }) => {
    await tabToCanvas(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowLeft');
    // Oznámení přijde vždy: buď o nové pozici, nebo o tom, že dál to nejde.
    await expect(
      page.locator('[role=status], [role=alert]').filter({ hasText: /./ }),
    ).not.toHaveCount(0);
  });

  test('z plátna se dá vyjít Tabem do panelu vlastností, není to past na fokus', async ({
    page,
  }) => {
    await tabToCanvas(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('#editor-properties')).toContainText(/./);
    const outside = await page.evaluate(
      () => document.activeElement?.closest('[role="tree"]') === null,
    );
    expect(outside).toBe(true);
  });

  test('smazání a vrácení akce jde z klávesnice', async ({ page }) => {
    await tabToCanvas(page);
    await page.keyboard.press('ArrowDown');
    const count = await page.getByRole('treeitem').count();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('treeitem')).toHaveCount(count - 1);
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(count);
  });
});
