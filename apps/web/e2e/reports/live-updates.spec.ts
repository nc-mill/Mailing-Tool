import { expect, test } from '@playwright/test';
import { STATS, stubReportApi } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

test('nad HTTP/1.1 se neotevře žádné SSE spojení (kritérium 94)', async ({ page }) => {
  await stubReportApi(page, { status: 'sending' });
  const streamRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/stream')) streamRequests.push(request.url());
  });
  await page.goto('/w/demo/campaigns/c1/report');
  await page.waitForTimeout(1000);
  // Testovací server Playwrightu jede po HTTP/1.1, takže klient musí zvolit dotazování.
  expect(streamRequests).toEqual([]);
});

test('report se dá načíst a obnovit i bez živých aktualizací (kritérium 102)', async ({ page }) => {
  await stubReportApi(page, { status: 'sending' });
  await page.route('**/api/v1/campaigns/*/stream', (route) => route.abort());
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByRole('heading', { name: 'Kliklo' })).toBeVisible();
  await page.getByRole('button', { name: 'Zkusit znovu' }).last().click();
  await expect(page.getByRole('heading', { name: 'Kliklo' })).toBeVisible();
});

test('výpadek sítě report nezastaví, po obnovení se čísla dopočítají', async ({ page }) => {
  // Tenhle scénář je jádro tvrdého požadavku: spojení spadne, klient se ptá
  // dál a jakmile server odpoví, na obrazovce je NOVÉ číslo, ne to staré.
  let call = 0;
  await stubReportApi(page, { status: 'sending' });
  await page.route('**/api/v1/campaigns/*/stats', async (route) => {
    call += 1;
    if (call === 1) {
      return route.fulfill({
        json: { ...STATS, status: 'sending', counts: { ...STATS.counts, clicks_unique_human: 10 } },
        headers: { ETag: 'W/"1"' },
      });
    }
    if (call <= 3) return route.abort('failed');
    return route.fulfill({
      json: { ...STATS, status: 'sending', counts: { ...STATS.counts, clicks_unique_human: 777 } },
      headers: { ETag: 'W/"9"' },
    });
  });

  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByTestId('headline-tiles')).toContainText('10');
  // Interval při odesílání jsou tři sekundy, takže čtvrtý pokus přijde
  // nejpozději do dvanácti. Čísla musí dojet sama, bez zásahu uživatele.
  await expect(page.getByTestId('headline-tiles')).toContainText('777', { timeout: 20_000 });
  expect(call).toBeGreaterThan(3);
});

test('šest karet reportu nezablokuje sedmý požadavek na API (kritérium 94)', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const pages = [];
  for (let i = 0; i < 6; i += 1) {
    const page = await context.newPage();
    await stubReportApi(page, { status: 'sending' });
    await page.goto('/w/demo/campaigns/c1/report');
    pages.push(page);
  }
  const seventh = await context.newPage();
  await stubReportApi(seventh);
  const started = Date.now();
  await seventh.goto('/w/demo/campaigns/c1/report');
  await expect(seventh.getByRole('heading', { name: 'Kliklo' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(20_000);
  await context.close();
});

test('v režimu dotazování se nezměněná data nepřekreslují', async ({ page }) => {
  let calls = 0;
  await stubReportApi(page, { status: 'sending' });
  await page.route('**/api/v1/campaigns/*/stats', (route) => {
    calls += 1;
    if (calls === 1) {
      return route.fulfill({ json: { ...STATS, status: 'sending' }, headers: { ETag: 'W/"42"' } });
    }
    return route.fulfill({ status: 304, body: '' });
  });
  await page.goto('/w/demo/campaigns/c1/report');
  await page.waitForTimeout(5000);
  expect(calls).toBeGreaterThan(1);
  await expect(page.getByRole('heading', { name: 'Kliklo' })).toBeVisible();
});
