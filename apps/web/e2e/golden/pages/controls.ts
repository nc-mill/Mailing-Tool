import type { Locator, Page } from '@playwright/test';

/**
 * Ovládání formulářových prvků, které nejsou nativní HTML.
 *
 * DOPLNĚK NAD PLÁN, vynucený spuštěním. Plán počítá u výběrů s
 * `selectOption()`, tedy s nativním `<select>`. Design systém P05 ale staví
 * výběry nad `radix-ui` (`packages/ui/src/components/select.tsx`), takže
 * v DOM je `<button role="combobox">` a běh spadl doslova na
 *
 *   Error: locator.selectOption: Error: Element is not a <select> element
 *     locator resolved to <button role="combobox" aria-label="Jazyk rozhraní" …>
 *
 * Oprava patří sem, do objektů obrazovek, ne do scénáře, a rozhodně ne do
 * komponent P05: test se přizpůsobuje produktu, ne naopak.
 *
 * Pomocníci zvládnou obě podoby. Až někdo výběr přepíše zpátky na nativní,
 * testy se nemusí měnit.
 */

/** Vybere hodnotu ve výběru, ať je nativní, nebo z design systému. */
export async function chooseOption(
  page: Page,
  fieldLabel: string | RegExp,
  optionLabel: string,
): Promise<void> {
  const control = page.getByLabel(fieldLabel).first();
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());

  if (tag === 'select') {
    await control.selectOption({ label: optionLabel });
    return;
  }

  await control.click();
  await page.getByRole('option', { name: optionLabel, exact: false }).first().click();
}

/**
 * Zaškrtne přepínač.
 *
 * `check()` na `<button role="radio">` z radix-ui neprojde, protože Playwright
 * čeká nativní `<input type="radio">`. Klik dělá totéž a funguje na obojím.
 */
export async function chooseRadio(page: Page, name: string | RegExp): Promise<void> {
  const radio = page.getByRole('radio', { name }).first();
  await radio.click();
}

/** Přepne na záložku podle jména. */
export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('tab', { name }).first().click();
}

/** Tlačítko podle jména, první nalezené. */
export function button(page: Page, name: string | RegExp): Locator {
  return page.getByRole('button', { name }).first();
}
