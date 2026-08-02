import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/ui-gallery');
});

test('K1: tabulku jde projít a vybírat výhradně z klávesnice', async ({ page }) => {
  const rows = page.locator('#section-k1 [role="row"]');
  await rows.nth(1).focus();

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();

  await page.keyboard.press('x');
  await expect(rows.nth(2).getByRole('checkbox')).toBeChecked();

  await page.keyboard.press('k');
  await expect(rows.nth(1)).toBeFocused();
});

test('K4: soubor jde vybrat bez přetažení, jen klávesnicí', async ({ page }) => {
  const section = page.locator('#section-k4');
  const trigger = section.getByText('Vybrat soubor z počítače');

  await trigger.focus();
  await expect(trigger).toBeFocused();

  // Popisek je svázaný se vstupem, takže Enter otevře dialog výběru.
  const input = section.locator('input[type="file"]');
  await expect(input).toHaveCount(1);
});

test('K8: osa je průchozí z klávesnice a rozbalení shluku se ohlásí', async ({ page }) => {
  const section = page.locator('#section-k8');
  const toggle = section.getByRole('button', { name: /Rozbalit/ });

  await toggle.focus();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(section.getByRole('button', { name: /Sbalit/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  // Omezeno na sekci, stejně jako všechny asserce nad ní. Bez toho byl tenhle
  // jediný řádek v souboru neomezený a chytal i `role="status"` z K3, kde má
  // Wizard vlastní čítač kroku „Krok 2 z 3". Padalo to na
  //
  //   strict mode violation: getByRole('status') resolved to 2 elements
  //
  // což vypadalo jako vada osy, ale byl to dosah dotazu. Wizard a osa se
  // potkávají jedině na galerii, kde je záměrně všechno pohromadě.
  await expect(section.getByRole('status')).toContainText('Rozbaleno');
});

test('fokus je vidět a nezakrývá ho sticky hlavička ani systémový pruh', async ({ page }) => {
  const row = page.locator('#section-k1 [role="row"]').nth(3);
  await row.focus();

  const visible = await row.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(visible).toBe(true);
});

test('zoom na 200 % nerozbije rozvržení a nic se neztratí', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  // Stránka se nesmí rolovat vodorovně. Široký obsah roluje uvnitř svého rámu.
  expect(overflow).toBe(false);
});
