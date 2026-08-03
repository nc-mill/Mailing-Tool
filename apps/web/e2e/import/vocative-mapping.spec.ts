import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Oslovení ve vokativu je důvod, proč tenhle nástroj vznikl, takže krok Náhled
 * ho MUSÍ ukázat u jména, které přišlo v jednom sloupci.
 *
 * Vada, kterou tenhle soubor hlídá, prošla jednotkovými testy i typovou
 * kontrolou. Modul `contacts/naming` uměl rozdělit „Jana Nováková" i spočítat
 * „Jano" bezchybně, jenže se k němu celé jméno nikdy nedostalo: návrh mapování
 * se rozhodoval JEN podle názvu sloupce, a české „Jméno" přiřadil na `first_name`.
 * Do `first_name` tak spadlo celé „Jana Nováková", příjmení i titul zůstaly
 * prázdné a všech padesát kontaktů dostalo neutrální „Dobrý den".
 *
 * Poznat to jde jedině na výsledku, protože obě vrstvy byly samy o sobě
 * „v pořádku".
 *
 * `storageState` se vynuluje: konfigurace P05 vkládá falešnou relační cookie
 * kvůli galerii, se kterou by tenhle test neřekl nic o skutečné relaci.
 * `locale` je taky schválně, jinak proxy pošle prohlížeč na anglickou verzi.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

/**
 * Jedno přihlášení na celý soubor, a proto sériově.
 *
 * Přihlašovací formulář omezuje počet pokusů z jedné adresy. Kdyby se každý test
 * přihlašoval sám, srazí se testy v tomhle souboru s testy ve vedlejším, obrana
 * je odmítne a spadnou na přihlášení, tedy na něčem, co s importem nesouvisí.
 * Relace se získá jednou a další testy si její cookie jen převezmou.
 *
 * Limit je zvednutý kvůli témuž: když omezovač přesto zabere, čeká se, až povolí.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const EMAIL = 'dev@mlain.test';
const PASSWORD = process.env['E2E_DEV_PASSWORD'] ?? 'Vyvojove-Heslo-2026-Mlain';
const WORKSPACE_SLUG = 'preflight-projekt';

/**
 * Pět jmen, na kterých se čeština chová pokaždé jinak:
 *   Jana    -> Jano     (ženská -a se mění na -o)
 *   Petr    -> Petře    (souhlásková změna)
 *   Ondřej  -> Ondřeji  (měkké -j)
 *   Jiří    -> Jiří     (nemění se)
 *   Lucie   -> Lucie    (nemění se)
 * Dvě poslední jsou tam schválně: vokativ, který každé jméno „nějak" ohne, je
 * stejná vada jako vokativ, který neohne nic.
 */
const NAMES = ['Jana Nováková', 'Ing. Petr Svoboda', 'Ondřej Dvořák', 'Jiří Novotný', 'Lucie Malá'];

/**
 * 51 řádků: hlavička a 50 kontaktů, oddělovač čárka, kódování UTF-8.
 *
 * Adresy nesou razítko běhu. Klíč idempotence je otisk OBSAHU souboru, takže
 * s pevnými adresami by druhé spuštění testu narazilo na „tenhle soubor už
 * jste nahráli" a nedostalo se na krok, který má hlídat.
 */
function writeFixture(headerName: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const lines = [`${headerName},E-mail,Město`];
  for (let i = 0; i < 50; i += 1) {
    lines.push(`${NAMES[i % NAMES.length]},kontakt${i + 1}-${stamp}@example.com,Břeclav`);
  }
  const path = join(mkdtempSync(join(tmpdir(), 'mlain-e2e-vokativ-')), 'contacts-50.csv');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

/**
 * Přihlášení, které POČKÁ na omezovač pokusů.
 *
 * Přihlašovací formulář má omezení počtu pokusů z jedné adresy a při vývoji se
 * naplní snadno: stačí pustit sadu e2e testů dvakrát za sebou. Bez tohohle
 * čekání pak spadne na vypršení `waitForURL` a vypadá to jako vada přihlášení,
 * přestože je to obrana, která funguje správně. Rozdíl se pozná na obrazovce,
 * takže se čte, ne hádá.
 */
async function signIn(page: Page): Promise<void> {
  const rateLimited = page.getByRole('heading', { name: 'Zkoušíte to příliš často' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/login');
    await page.locator('input#email').fill(EMAIL);
    await page.locator('input#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    const outcome = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 })
        .then(() => 'in' as const),
      rateLimited.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'limited' as const),
    ]);
    if (outcome === 'in') return;
    // Kolik sekund se má čekat, říká sama hláška, a s každým dalším pokusem
    // roste. Pevná pauza by se po druhém běhu netrefila.
    const notice = await page.getByText(/Počkejte \d+ sekund/).innerText();
    const seconds = Number(notice.match(/Počkejte (\d+) sekund/)?.[1] ?? '30');
    await page.waitForTimeout((seconds + 2) * 1000);
  }
  throw new Error('Přihlášení se nepodařilo ani po čekání na omezovač pokusů.');
}

let session: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;

test.beforeAll(async ({ browser }) => {
  // Limit hooku se NEŘÍDÍ `describe.configure({ timeout })`, ten platí jen pro
  // testy. Bez tohohle řádku má `beforeAll` výchozích 30 sekund a čekání na
  // omezovač pokusů se do nich nevejde.
  test.setTimeout(240_000);
  const context = await browser.newContext({ locale: 'cs-CZ' });
  const page = await context.newPage();
  await signIn(page);
  session = await context.storageState();
  await context.close();
});

test.beforeEach(async ({ context }) => {
  if (session === null) throw new Error('Relace z beforeAll chybí.');
  await context.addCookies(session.cookies);
});

/** Dojde z nahrání až na krok Mapování. */
async function uploadToMapping(page: Page, headerName: string): Promise<void> {
  await page.goto(`/w/${WORKSPACE_SLUG}/contacts/import`);
  await page.locator('input[type="file"]').setInputFiles(writeFixture(headerName));
  await expect(page.getByRole('heading', { name: /zkontrolujte, jestli soubor/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Ano, je to správně' }).click();
  await expect(page.getByRole('columnheader', { name: 'Uložit jako' })).toBeVisible();
}

/**
 * Přečte jeden řádek náhledu podle křestního jména a porovná ho CELÝ.
 *
 * Sloupce jsou v pořadí e-mail, titul, jméno, rod, příjmení, oslovení. Kontrola
 * po jedné buňce by prošla i tehdy, kdyby se hodnoty rozsypaly do vedlejších
 * sloupců, což je přesně ta vada, kterou tenhle test hlídá.
 */
async function readRow(
  page: Page,
  firstName: string,
): Promise<{ titlePrefix: string; firstName: string; lastName: string; greeting: string }> {
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: firstName, exact: true }) })
    .first();
  await expect(row, `v náhledu chybí řádek se jménem ${firstName}`).toBeVisible();
  const cells = (await row.locator('td').allInnerTexts()).map((cell) => cell.trim());
  return {
    titlePrefix: cells[1] ?? '',
    firstName: cells[2] ?? '',
    lastName: cells[4] ?? '',
    greeting: cells[5] ?? '',
  };
}

async function expectVocative(
  page: Page,
  expected: { titlePrefix: string; firstName: string; lastName: string; greeting: string },
): Promise<void> {
  expect(await readRow(page, expected.firstName)).toEqual(expected);
}

test('sloupec „Jméno" s celými jmény se sám přiřadí na Celé jméno a náhled ukáže vokativ', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  await uploadToMapping(page, 'Jméno');

  // Jádro opravy: rozhodnutí padlo podle HODNOT, ne podle názvu sloupce.
  // „Jméno" znamená v českých exportech křestní i celé jméno, takže z názvu
  // se to poznat nedá; z „Jana Nováková" ano.
  await expect(page.getByLabel('Jméno', { exact: true })).toHaveValue('full_name');
  await expect(page.getByText('Rozdělíme na jméno a příjmení')).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Zobrazit náhled' }).click();
  await expect(page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();

  await expectVocative(page, {
    titlePrefix: '',
    firstName: 'Jana',
    lastName: 'Nováková',
    greeting: 'Dobrý den, Jano',
  });
  await expectVocative(page, {
    titlePrefix: 'Ing.',
    firstName: 'Petr',
    lastName: 'Svoboda',
    greeting: 'Dobrý den, Petře',
  });
  await expectVocative(page, {
    titlePrefix: '',
    firstName: 'Ondřej',
    lastName: 'Dvořák',
    greeting: 'Dobrý den, Ondřeji',
  });
  // Jména, která se v 5. pádu NEMĚNÍ. Vokativ, který ohne všechno, je stejná
  // vada jako vokativ, který neohne nic.
  await expectVocative(page, {
    titlePrefix: '',
    firstName: 'Jiří',
    lastName: 'Novotný',
    greeting: 'Dobrý den, Jiří',
  });
  await expectVocative(page, {
    titlePrefix: '',
    firstName: 'Lucie',
    lastName: 'Malá',
    greeting: 'Dobrý den, Lucie',
  });

  // Ani jedno „Dobrý den" bez jména: neutrální záloha je tady známka poruchy.
  await expect(page.getByRole('cell', { name: 'Dobrý den', exact: true })).toHaveCount(0);

  expect(failures, 'v konzoli prohlížeče nesmí být chyba').toEqual([]);
});

test('ruční přemapování na Celé jméno se uloží a projeví se v náhledu', async ({ page }) => {
  const failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  // Hlavička, kterou slovník nezná, takže návrh je „Nepoužívat" a volbu musí
  // udělat člověk. Tím se měří DRUHÁ cesta: uloží PATCH z prohlížeče to, co
  // uživatel vybral, nebo obrazovka změnu jen přijme a zahodí ji?
  await uploadToMapping(page, 'Kontaktní osoba');

  const select = page.getByLabel('Kontaktní osoba', { exact: true });
  await expect(select).toHaveValue('ignore');
  await select.selectOption('full_name');

  await page.getByRole('button', { name: 'Zobrazit náhled' }).click();
  await expect(page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();

  await expectVocative(page, {
    titlePrefix: '',
    firstName: 'Jana',
    lastName: 'Nováková',
    greeting: 'Dobrý den, Jano',
  });
  await expectVocative(page, {
    titlePrefix: 'Ing.',
    firstName: 'Petr',
    lastName: 'Svoboda',
    greeting: 'Dobrý den, Petře',
  });

  expect(failures, 'v konzoli prohlížeče nesmí být chyba').toEqual([]);
});
