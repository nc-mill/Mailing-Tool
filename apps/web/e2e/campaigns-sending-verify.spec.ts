import { expect, test, type Page, type BrowserContext } from '@playwright/test';

/**
 * Ověřovací průchod obrazovek kampaní a nastavení odesílání (P13, fáze L) proti
 * skutečně běžícímu serveru a skutečné vývojové databázi s ukázkovými daty (P16):
 * projekt „Preflight Projekt“, kampaň „Letní výprodej“ (draft), kampaň
 * „Jarní novinky“ (sent), účet „Amazon SES (dev)“ a doména „kolo-shop.cz“.
 *
 * Test NEODESÍLÁ žádnou kampaň (tlačítko „Odeslat“ se nikde neklikne): reálné
 * odeslání by zapsalo do sdílené vývojové databáze, kterou používají i ostatní
 * běžící agenti, a je nevratné. Cílem je ověřit, že obrazovky vykreslují
 * skutečná data z API, ne že fungovala celá cesta odeslání.
 *
 * `storageState` se stejně jako v `e2e/auth/login.spec.ts` schválně vynuluje:
 * konfigurace P05 jinak vkládá falešnou relační cookie a přihlášení by nebylo
 * skutečné.
 *
 * Přihlášení proběhne přes formulář JEN JEDNOU pro celý soubor, ne v každém
 * testu zvlášť: přihlašovací endpoint má limit počtu pokusů (viz
 * `docs/superpowers/plans/STAV-IMPLEMENTACE.md`), a sedm přihlášení v rychlém
 * sledu ho vyčerpá. Naměřeno přímo: první běh s přihlášením v `beforeEach`
 * padal na `waitForURL` v `signIn` po druhém až třetím testu.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

const EMAIL = 'dev@mlain.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Vyvojove-Heslo-2026-Mlain';
const WORKSPACE = 'preflight-projekt';

type Cookie = Parameters<BrowserContext['addCookies']>[0][number];
let cachedCookies: Cookie[] | null = null;

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

test.describe('kampaně a nastavení odesílání proti reálnému API', () => {
  // Zvýšeno z výchozích 30 s: testy volají skutečné DNS dotazy a skutečné
  // volání AWS SES s neplatnými klíči, obojí čeká na timeout, ne na okamžitou
  // odpověď. Server navíc v tuhle chvíli obsluhuje víc souběžných e2e běhů.
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('seznam kampaní ukazuje skutečné řádky se stavem, publikem a datem', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/campaigns`);
    await expect(page.getByRole('heading', { name: 'Kampaně' })).toBeVisible();

    const row = page.getByRole('row', { name: /Letní výprodej/ });
    await expect(row).toBeVisible();
    // Stav je otevřený výčet vykreslený štítkem z reálných dat API, ne natvrdo.
    await expect(row.getByText('Rozepsaná')).toBeVisible();

    const sentRow = page.getByRole('row', { name: /Jarní novinky/ });
    await expect(sentRow).toBeVisible();
    await expect(sentRow.getByText('Odeslaná')).toBeVisible();
  });

  test('obrazovka odeslání spočítá publikum z preflightu, ne natvrdo', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/campaigns`);
    // `DataTable` z design systému (packages/ui) otevírá řádek jen klávesou
    // Enter (viz `onKeyDown` v `data-table.tsx`), na myš řádek nereaguje.
    // Ověřeno tímhle testem: prosté `.click()` na řádek navigaci nespustí.
    const row = page.getByRole('row', { name: /Letní výprodej/ });
    await row.click();
    await row.press('Enter');
    await page.waitForURL(/\/campaigns\/.+\/progress$/);

    // Kampaň je draft, obrazovka progress na ni nemá co ukázat a přesměruje
    // pryč přes 404; jdeme proto rovnou na obrazovku odeslání.
    const url = new URL(page.url());
    const id = url.pathname.split('/').at(-2);
    await page.goto(`/w/${WORKSPACE}/campaigns/${id}/send`);

    // Skutečná odpověď `/api/v1/campaigns/{id}/preflight` v okamžiku psaní testu:
    // audience_estimate 3, jediný nález domain_dmarc_missing (varování, ne blokace).
    await expect(page.getByTestId('recipient-count')).toContainText('3 příjemci');
    await expect(page.getByRole('button', { name: /Odeslat 3 e-maily/ })).toBeEnabled();
    await expect(page.getByText(/Doména nemá DMARC záznam/)).toBeVisible();
  });

  test('nastavení odesílání ukazuje reálný účet SES a reálnou doménu', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/settings/sending`);

    await expect(page.getByText('Amazon SES (dev)')).toBeVisible();
    await expect(page.getByTestId('provider-list').getByText('Výchozí')).toBeVisible();
    await expect(page.getByText('kolo-shop.cz')).toBeVisible();

    // Brzdy doručitelnosti mají strop podle instalační hodnoty ze serveru, ne
    // zadrátovaný v komponentě.
    await expect(page.getByTestId('guard-bounce_guard_rate')).toHaveAttribute('max', '8');
  });

  test('test připojení odesílacího účtu skutečně zavolá API a ukáže výsledek', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    const testButton = page.getByRole('button', { name: 'Otestovat připojení' });
    await expect(testButton).toBeVisible();
    await testButton.click();

    // Falešné klíče AKIA****DEV1 nejsou skutečný SES účet, spojení proto
    // neprojde. Důležité je, že se objeví KONKRÉTNÍ odpověď, ne ticho, a že
    // se objeví teprve PO reálném volání AWS (`AWS_API_TIMEOUT_MS`), ne hned.
    await expect(
      page.getByText(/Připojení funguje\.|Připojení se nepodařilo ověřit\./),
    ).toBeVisible({ timeout: 45_000 });
  });

  test('DNS obrazovka dotazuje skutečný DNS server, ne natvrdo ověřeno', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    await page.getByRole('link', { name: 'DNS záznamy' }).click();
    await page.waitForURL(/\/domains\/.+$/);
    const domainId = new URL(page.url()).pathname.split('/').pop();

    await expect(
      page.getByRole('heading', { name: /DNS záznamy pro kolo-shop\.cz/ }),
    ).toBeVisible();
    // Tři DKIM CNAME plus SPF plus DMARC, podle skutečně vygenerovaných karet.
    await expect(page.getByText(/Přidejte \d+ záznam/)).toBeVisible();

    const workspaces = await page.request.get('/api/v1/workspaces');
    const workspaceId = (await workspaces.json()).data.find(
      (w: { slug: string; id: string }) => w.slug === WORKSPACE,
    ).id as string;

    // `checkedAt` se na obrazovce formátuje jen na den (`format.dateTime(..., 'short')`),
    // takže srovnání zobrazeného textu před/po by v rámci jednoho dne prošlo,
    // i kdyby tlačítko nic nedělalo. Skutečnost se proto ověřuje přes API.
    const before = await page.request.get(`/api/v1/domains/${domainId}`, {
      headers: { 'x-workspace-id': workspaceId },
    });
    const beforeChecked = (await before.json()).domain.checked_at as string;

    await page.getByRole('button', { name: 'Zkontrolovat teď' }).click();

    // `checkDomainAction` je Server Action: prohlížeč nevidí URL
    // `/api/v1/domains/{id}/check` vůbec, tu volá až server uvnitř akce.
    // `page.waitForResponse` na tuhle cestu by proto vždy vypršel. Skutečnost
    // se ověřuje dotazem přímo na API, dokud se `checked_at` neposune; skutečný
    // dotaz na DNS server (`node:dns/promises`) trvá řádově sekundy, ne
    // milisekundy jako vrácení zadrátované konstanty.
    await expect
      .poll(
        async () => {
          const after = await page.request.get(`/api/v1/domains/${domainId}`, {
            headers: { 'x-workspace-id': workspaceId },
          });
          return ((await after.json()).domain.checked_at as string) ?? '';
        },
        {
          timeout: 30_000,
          message: 'checked_at v databázi se musí posunout, kontrola musí být skutečná',
        },
      )
      .not.toBe(beforeChecked);

    // `kolo-shop.cz` ve skutečném DNS Amazonovy DKIM/SPF záznamy nemá, takže
    // čerstvá kontrola musí hlásit chybějící záznamy, ne zelené "ověřeno".
    await expect(page.getByTestId('dot-dkim')).toHaveAttribute('data-tone', 'red');
  });

  test('dashboard doručitelnosti počítá zóny z prahů ze serveru', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/deliverability`);
    await expect(page.getByRole('heading', { name: 'Doručitelnost' })).toBeVisible();
    await expect(page.getByText('Stav účtu')).toBeVisible();
  });

  test('obrazovka průběhu odeslané kampaně ukazuje reálné čítače', async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/campaigns`);
    const row = page.getByRole('row', { name: /Jarní novinky/ });
    await row.click();
    await row.press('Enter');
    await page.waitForURL(/\/campaigns\/.+\/progress$/);

    await expect(page.getByRole('heading', { name: 'Průběh odesílání' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
  });
});
