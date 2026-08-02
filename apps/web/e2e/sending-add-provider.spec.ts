import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Zakládání odesílacího účtu proti běžícímu serveru a skutečné vývojové
 * databázi. Test NEJEN klikne, ale ověří, že účet opravdu vznikne v API,
 * a po sobě ho zase smaže: sdílenou vývojovou databázi používají i ostatní
 * agenti a nechat v ní odpadky by rozbilo jejich testy.
 *
 * Účet se schválně NEZAKLÁDÁ jako výchozí. Výchozí účet je stav projektu,
 * který používá preflight kampaní, a přepnout ho by rozbilo `campaigns-sending-verify`.
 *
 * `storageState` se stejně jako v ostatních spec souborech vynuluje:
 * konfigurace P05 jinak vkládá falešnou relační cookie a přihlášení by nebylo
 * skutečné.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

const EMAIL = 'dev@mlain.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Vyvojove-Heslo-2026-Mlain';
const WORKSPACE = 'preflight-projekt';

type Cookie = Parameters<BrowserContext['addCookies']>[0][number];
let cachedCookies: Cookie[] | null = null;

/**
 * Přihlášení formulářem proběhne JEN JEDNOU pro celý soubor, ostatní testy
 * dostanou hotové cookies. Ze stejného důvodu jako v `campaigns-sending-verify`:
 * přihlašovací endpoint má strop počtu pokusů a několik přihlášení naráz ho
 * vyčerpá. Naměřeno přímo, běh s přihlášením v každém testu padal na `waitForURL`.
 */
async function signIn(page: Page): Promise<void> {
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    return;
  }
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  cachedCookies = await page.context().cookies();
}

async function workspaceId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/workspaces');
  const body = (await response.json()) as { data: Array<{ slug: string; id: string }> };
  const found = body.data.find((w) => w.slug === WORKSPACE);
  if (!found) throw new Error(`Projekt ${WORKSPACE} v API není, ukázková data chybí.`);
  return found.id;
}

test.describe('přidání odesílacího účtu', () => {
  // Sériově, ne paralelně: konfigurace P05 má `fullyParallel: true`, takže by
  // testy jednoho souboru padly do dvou procesů, každý by se přihlašoval zvlášť
  // a strop pokusů by se vyčerpal. Cache cookies dává smysl jen v jednom procesu.
  test.describe.configure({ mode: 'serial' });
  // Přihlášení plus dvě volání API navíc; výchozích 30 s je na sdíleném
  // vývojovém serveru těsných.
  test.setTimeout(90_000);

  test('tlačítko Přidat odesílací účet otevře dialog s přepínačem typu', async ({ page }) => {
    // Každá odpověď mimo 2xx a 3xx se vypíše, aby bylo vidět, odkud se bere
    // 404 hlášená v konzoli. Bez tohohle se hledá naslepo.
    const badResponses: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await signIn(page);
    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    await expect(page.getByRole('heading', { name: 'Odesílací účty' })).toBeVisible();

    await page.getByTestId('add-provider').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nový odesílací účet' })).toBeVisible();
    // Zlatá cesta hledá právě tenhle přepínač. Typ účtu NESMÍ být rozbalovací
    // seznam: dvě různé sady polí má uživatel vidět naráz.
    await expect(page.getByRole('radio', { name: 'Amazon SES' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Vlastní SMTP/ })).toBeVisible();

    // Přepnutí typu skutečně vymění sadu polí, ne jen vizuálně přebarví volbu.
    await expect(page.getByTestId('provider-access-key-id')).toBeVisible();
    await page.getByRole('radio', { name: /Vlastní SMTP/ }).click();
    await expect(page.getByTestId('provider-host')).toBeVisible();
    await expect(page.getByTestId('provider-access-key-id')).toHaveCount(0);

    // `console.error` je jediná povolená metoda; jde o diagnostiku běhu, ne o chybu.
    console.error(
      'ODPOVEDI >= 400:',
      badResponses.length === 0 ? 'zadne' : badResponses.join(' | '),
    );
    console.error(
      'CHYBY V KONZOLI:',
      consoleErrors.length === 0 ? 'zadne' : consoleErrors.join(' | '),
    );
  });

  test('vyplněný dialog účet skutečně založí a seznam ho hned ukáže', async ({ page }) => {
    await signIn(page);
    const id = await workspaceId(page);
    // Jméno je jedinečné pro každý běh: sdílená databáze snese víc běhů za sebou
    // a test nesmí spadnout na tom, že tam účet z minula ještě je.
    const name = `E2E SMTP ${Date.now()}`;

    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    await page.getByTestId('add-provider').click();
    await page.getByRole('radio', { name: /Vlastní SMTP/ }).click();

    await page.getByTestId('provider-name').fill(name);
    await page.getByTestId('provider-host').fill('smtp.wedos.net');
    await page.getByTestId('provider-username').fill('posta@kolo-shop.cz');
    await page.getByTestId('provider-password').fill('tajne-heslo-e2e');

    await page.getByTestId('add-provider-submit').click();

    // Dialog se zavře jen při úspěchu; při chybě zůstane otevřený s hláškou.
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('provider-list').getByText(name)).toBeVisible();

    // Rozhoduje databáze, ne obrazovka: účet musí být i v odpovědi API.
    const listed = await page.request.get('/api/v1/providers', {
      headers: { 'x-workspace-id': id },
    });
    const body = (await listed.json()) as {
      data: Array<{ id: string; name: string; type: string; is_default: boolean; config: unknown }>;
    };
    const created = body.data.find((provider) => provider.name === name);
    expect(created, 'nový účet musí být v GET /api/v1/providers').toBeTruthy();
    expect(created!.type).toBe('smtp');
    // Heslo ani uživatelské jméno z API nikdy neodejdou v čitelné podobě.
    expect(JSON.stringify(created!.config)).not.toContain('tajne-heslo-e2e');
    // Nezakládá se jako výchozí, dokud si to uživatel nezaškrtne.
    expect(created!.is_default).toBe(false);

    // Úklid. Bez něj by ve sdílené databázi zůstal účet po každém běhu.
    const deleted = await page.request.delete(`/api/v1/providers/${created!.id}`, {
      headers: { 'x-workspace-id': id },
    });
    expect(deleted.status(), 'úklid po testu musí projít').toBe(204);
  });
});
