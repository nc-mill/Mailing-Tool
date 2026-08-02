import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Krok „Kontrola souboru" musí ukazovat ČÍSLA ZE SERVERU.
 *
 * Vada, kterou tenhle soubor hlídá, prošla jednotkovými testy i typovou
 * kontrolou: `/preview` vracel pětistovku, průvodce ji tiše přeskakoval
 * (`if (!res.ok) return;`) a obrazovka vykreslila výchozí hodnoty, tedy
 * středník a nula kontaktů. Server přitom měl v databázi správně detekovanou
 * čárku a padesát řádků. Poznat to jde jedině v prohlížeči, proti běžícímu
 * serveru, protože obě vrstvy byly samy o sobě „v pořádku".
 *
 * `storageState` se vynuluje: konfigurace P05 vkládá falešnou relační cookie
 * kvůli galerii, se kterou by tenhle test neřekl nic o skutečné relaci.
 * `locale` je taky schválně, jinak proxy pošle prohlížeč na anglickou verzi.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

const EMAIL = 'dev@mlain.test';
const PASSWORD = process.env['E2E_DEV_PASSWORD'] ?? 'Vyvojove-Heslo-2026-Mlain';
const WORKSPACE_SLUG = 'preflight-projekt';

/**
 * 51 řádků: hlavička a 50 kontaktů, oddělovač čárka, kódování UTF-8.
 *
 * Adresy nesou razítko běhu. Klíč idempotence je otisk OBSAHU souboru, takže
 * s pevnými adresami by druhé spuštění testu narazilo na „tenhle soubor už
 * jste nahráli" a nedostalo se na krok, který má hlídat.
 */
function writeFixture(): string {
  const stamp = Date.now();
  const first = ['Petr', 'Jana', 'Tomáš', 'Eva', 'Marek'];
  const last = ['Nováková', 'Svoboda', 'Dvořák', 'Černý', 'Procházka'];
  const lines = ['jmeno,email,prijmeni,titul,pohlavi,mesto'];
  for (let i = 0; i < 50; i += 1) {
    const f = first[i % first.length];
    const l = last[Math.floor(i / 5) % last.length];
    const email = `kontakt${i + 1}-${stamp}@example.com`;
    lines.push(`${f},${email},${l},Ing.,${i % 2 === 0 ? 'm' : 'f'},Břeclav`);
  }
  const path = join(mkdtempSync(join(tmpdir(), 'mlain-e2e-import-')), 'contacts-50.csv');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('krok Kontrola souboru ukáže 50 kontaktů a čárku jako oddělovač', async ({ page }) => {
  const failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  await signIn(page);
  await page.goto(`/w/${WORKSPACE_SLUG}/contacts/import`);

  await page.locator('input[type="file"]').setInputFiles(writeFixture());

  // Průvodce se po nahrání sám přepne na krok Kontrola souboru.
  await expect(page.getByRole('heading', { name: /zkontrolujte, jestli soubor/i })).toBeVisible({
    timeout: 30_000,
  });

  // Náhled se nesmí tiše přeskočit: chybová hláška by tu neměla co dělat.
  // Hledá se uvnitř obsahu, ne na celé stránce: vývojová vrstva Nextu si
  // vedle patičky drží vlastní prázdný prvek s rolí `alert`.
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);

  const line = page.getByText(/z toho 1 hlavička/i);
  await expect(line).toBeVisible();
  // 51 řádků souboru, z toho 50 kontaktů. Nesmí to být 0 ani délka náhledu.
  await expect(line).toContainText('51');
  await expect(line).toContainText('50');

  // Oddělovač ze serveru, ne výchozí středník.
  await expect(page.locator('select[name="delimiter"]')).toHaveValue(',');

  // Kódování a ukázka taky ze serveru, ve stejném pořadí sloupců jako hlavička.
  await expect(page.locator('input[name="encoding-value"]')).toHaveValue('utf-8');
  await expect(page.getByRole('cell', { name: 'Nováková' }).first()).toBeVisible();

  expect(failures, 'v konzoli prohlížeče nesmí být chyba').toEqual([]);

  /*
   * Průvodce jde dál, tedy uložení nastavení SKUTEČNĚ projde.
   *
   * Od chvíle, kdy neuložená změna zastaví přechod na další krok, je tohle
   * jediný důkaz, že PATCH posílá tvar, který server přijme. Mapování se
   * posílá pod indexem sloupce a jako objekt; obrazovka ho drží pod názvem
   * a jako řetězec, takže se to musí převádět.
   */
  await page.getByRole('button', { name: 'Ano, je to správně' }).click();
  await expect(page.getByRole('columnheader', { name: 'Uložit jako' })).toBeVisible();
  await expect(page.getByLabel('email')).toHaveValue('email');

  await page.getByRole('button', { name: 'Zobrazit náhled' }).click();
  await expect(page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  expect(failures, 'v konzoli prohlížeče nesmí být chyba').toEqual([]);
});
