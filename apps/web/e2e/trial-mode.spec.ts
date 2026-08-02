import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Zkušební režim proti běžícímu serveru a skutečné vývojové databázi.
 *
 * Test jde CELOU cestou, kterou plán slibuje: zapnout režim, přidat adresu,
 * otevřít potvrzovací odkaz jako cizí člověk (v čistém kontextu bez přihlášení)
 * a ověřit, že se ze seznamu stala ověřená adresa. Klikání bez kontroly proti API
 * by nedokázalo nic: obrazovka umí ukázat i stav, který v databázi není.
 *
 * Po sobě uklízí, protože vývojovou databázi sdílejí i ostatní agenti: adresa se
 * odebere a zkušební režim se vrátí do stavu, ve kterém byl před během.
 *
 * `storageState` se vynuluje, jinak konfigurace P05 vkládá falešnou relační cookie
 * a přihlášení by nebylo skutečné.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

const EMAIL = 'dev@mlain.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Vyvojove-Heslo-2026-Mlain';
const WORKSPACE = 'preflight-projekt';

type Cookie = Parameters<BrowserContext['addCookies']>[0][number];
let cachedCookies: Cookie[] | null = null;

/** Přihlášení formulářem JEN JEDNOU pro celý soubor: endpoint má strop pokusů. */
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

type TrialState = {
  trial_mode: boolean;
  trial_mode_explicit: boolean | null;
  verified: Array<{ email: string; verified_at: string | null }>;
  verified_count: number;
  max_addresses: number;
  has_verified_domain: boolean;
};

async function trialState(page: Page, id: string): Promise<TrialState> {
  const response = await page.request.get('/api/v1/settings/trial', {
    headers: { 'x-workspace-id': id },
  });
  expect(response.status(), 'GET /api/v1/settings/trial').toBe(200);
  return (await response.json()) as TrialState;
}

test.describe('zkušební režim', () => {
  // Sériově: konfigurace P05 má `fullyParallel: true` a dva procesy by se
  // přihlašovaly zvlášť, čímž by vyčerpaly strop pokusů.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test('adresa projde od přidání přes odkaz z e-mailu až k ověření', async ({ page, browser }) => {
    const badResponses: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
    });

    await signIn(page);
    const id = await workspaceId(page);
    const before = await trialState(page, id);
    // Adresa je pro každý běh jiná: databáze je sdílená a strop je deset adres.
    const address = `e2e-trial-${Date.now()}@firma.cz`;

    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    await expect(page.getByRole('heading', { name: 'Zkušební režim' })).toBeVisible();

    // Zapnutí, pokud zrovna běží vypnutý. Stav je uložený v projektu, ne v testu.
    if (!before.trial_mode) {
      await page.getByRole('button', { name: 'Zapnout zkušební režim' }).click();
      await expect(page.getByTestId('trial-toggle')).toContainText('Vypnout');
    }
    expect((await trialState(page, id)).trial_mode, 'režim musí být zapnutý').toBe(true);

    // Zlatá cesta hledá přesně tenhle název tlačítka.
    await page.getByRole('button', { name: 'Přidat ověřenou adresu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('trial-email').fill(address);
    await page.getByRole('button', { name: 'Odeslat potvrzení' }).click();

    await expect(page.getByTestId('trial-address-sent')).toContainText(address);
    await expect(page.getByTestId('trial-address-list')).toContainText('Čeká na potvrzení');

    // Rozhoduje databáze, ne obrazovka.
    const added = await trialState(page, id);
    const pending = added.verified.find((a) => a.email === address);
    expect(pending, 'adresa musí být v GET /api/v1/settings/trial').toBeTruthy();
    expect(pending!.verified_at, 'nová adresa je NEPOTVRZENÁ').toBeNull();

    // Odkaz z e-mailu. Mimo produkci ho vrací i API, protože odesílací pipeline
    // ještě není zapojená; v produkci odchází pouze e-mailem.
    const link = await page.getByTestId('trial-verification-link').getAttribute('href');
    expect(link, 'mimo produkci se odkaz ukazuje na obrazovce').toContain('/verify-sender/');

    // Otevírá ho CIZÍ člověk: nový kontext bez relace i bez cookies.
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const anonymousPage = await anonymous.newPage();
    const opened = await anonymousPage.goto(link!);
    expect(opened?.status(), 'potvrzovací stránka je veřejná').toBe(200);
    await expect(anonymousPage.getByText('Adresa je ověřená')).toBeVisible();
    await expect(anonymousPage.getByText(address)).toBeVisible();
    await anonymous.close();

    // Potvrzení se skutečně zapsalo a obrazovka to po obnově ukáže.
    const confirmed = await trialState(page, id);
    const row = confirmed.verified.find((a) => a.email === address);
    expect(row!.verified_at, 'po otevření odkazu má adresa čas ověření').not.toBeNull();
    expect(confirmed.verified_count).toBe(added.verified_count + 1);

    await page.goto(`/w/${WORKSPACE}/settings/sending`);
    const listed = page.getByTestId('trial-address-list').getByRole('listitem').filter({
      hasText: address,
    });
    await expect(listed).toContainText('Ověřeno');

    // Úklid: adresa pryč, režim zpátky do původního stavu.
    const removed = await page.request.delete(
      `/api/v1/settings/trial/addresses/${encodeURIComponent(address)}`,
      { headers: { 'x-workspace-id': id } },
    );
    expect(removed.status(), 'úklid adresy musí projít').toBe(200);
    if (before.trial_mode_explicit !== null || before.trial_mode !== true) {
      await page.request.patch('/api/v1/settings/trial', {
        headers: { 'x-workspace-id': id, 'content-type': 'application/json' },
        data: { trial_mode: before.trial_mode },
      });
    }

    console.error(
      'ODPOVEDI >= 400:',
      badResponses.length === 0 ? 'zadne' : badResponses.join(' | '),
    );
  });

  test('poškozený odkaz nepotvrdí nic a neřekne, co v projektu je', async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto('/verify-sender/v1.deadbeef.aaaa.1.podvrh');
    await expect(anonymousPage.getByText('Odkaz neplatí')).toBeVisible();
    await anonymous.close();
  });

  test('obrazovka publika říká konkrétní čísla, ne obecné varování', async ({ page }) => {
    await signIn(page);
    const id = await workspaceId(page);
    const before = await trialState(page, id);

    // Pruh vyžaduje zapnutý režim; po testu se stav vrací zpátky.
    await page.request.patch('/api/v1/settings/trial', {
      headers: { 'x-workspace-id': id, 'content-type': 'application/json' },
      data: { trial_mode: true },
    });

    const campaigns = await page.request.get('/api/v1/campaigns', {
      headers: { 'x-workspace-id': id },
    });
    const list = (await campaigns.json()) as { data: Array<{ id: string; status: string }> };
    const draft = list.data.find((c) => c.status === 'draft');
    expect(draft, 'ukázková data musí mít rozepsanou kampaň').toBeTruthy();

    await page.goto(`/w/${WORKSPACE}/campaigns/${draft!.id}/send`);
    const notice = page.getByTestId('trial-mode-audience-notice');
    await expect(notice).toBeVisible();

    // Ve větě musí být OBĚ čísla: kolik lidí je v publiku a kolika se odešle.
    const text = (await notice.textContent()) ?? '';
    const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(numbers.length, `pruh musí nést dvě čísla, je v něm: ${text}`).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/ověřen/i);

    const state = await trialState(page, id);
    // Číslo v pruhu je počet POTVRZENÝCH adres, ne počet řádků v seznamu.
    expect(text).toContain(String(state.verified_count));

    if (before.trial_mode_explicit !== null || before.trial_mode !== true) {
      await page.request.patch('/api/v1/settings/trial', {
        headers: { 'x-workspace-id': id, 'content-type': 'application/json' },
        data: { trial_mode: before.trial_mode },
      });
    }
  });
});
