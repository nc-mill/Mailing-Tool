import { expect, test } from '@playwright/test';
import { STATS, ensureSession, stubReportApi } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

/**
 * Snímky obrazovek reportů pro vizuální kontrolu. Nejsou to testy chování,
 * ale důkaz, že obrazovky vypadají tak, jak mají, a že se hlavní metrika
 * (proklik) opravdu tváří jako hlavní. Spouští se stejně jako ostatní testy.
 */
const DIR = '../../.playwright-mcp';

test('snímek reportu kampaně', async ({ page }) => {
  await stubReportApi(page);
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByTestId('headline-tiles')).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-report-kampane.png`, fullPage: true });
});

test('snímek reportu s přepnutým odečítáním otevření', async ({ page }) => {
  await stubReportApi(page);
  await page.goto('/w/demo/campaigns/c1/report?opens=all');
  await expect(page.getByText('Zobrazena všechna otevření')).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-report-vsechna-otevreni.png`, fullPage: true });
});

test('snímek reportu odesílané kampaně', async ({ page }) => {
  await stubReportApi(page, {
    status: 'sending',
    open_breakdown: {
      verified: 44,
      machine: 48,
      uncertain: 4,
      total: 96,
      clicked_from_verified: 21,
    },
    predicted_opens: null,
    counts: {
      ...STATS.counts,
      sent: 428,
      materialized: 1129,
      delivered: 401,
      delivered_effective: 401,
      opens_unique: 96,
      opens_unique_human: 44,
      opens_unique_apple: 48,
      clicks_unique_human: 21,
    },
  });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByTestId('headline-tiles')).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-report-odesilani.png`, fullPage: true });
});

test('snímek reportu s vypnutým měřením', async ({ page }) => {
  await stubReportApi(page, { track_opens: false, track_clicks: false });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Měření otevření bylo pro tuto kampaň vypnuté')).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-report-mereni-vypnute.png`, fullPage: true });
});

test('snímek přehledu projektu', async ({ page }) => {
  await ensureSession(page);
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 30,
        computed_at: new Date().toISOString(),
        tiles: {
          sent: {
            status: 'ok',
            data: { value: 48320 },
            computed_at: new Date().toISOString(),
            stale: false,
          },
          click_rate: {
            status: 'ok',
            data: { rate: 0.038, delta: 0.004 },
            computed_at: new Date().toISOString(),
            stale: false,
          },
          open_rate: {
            status: 'ok',
            data: { rate: 0.241, machineShare: 0.41 },
            computed_at: new Date().toISOString(),
            stale: false,
          },
          problems: {
            status: 'ok',
            data: { level: 'ok' },
            computed_at: new Date().toISOString(),
            stale: false,
          },
          web_active: { status: 'error', code: 'tile_unavailable' },
          recent_campaigns: {
            status: 'ok',
            data: {
              items: [
                { campaignId: 'a', name: 'Letní výprodej', clickRate: 0.041 },
                { campaignId: 'b', name: 'Novinky v červnu', clickRate: 0.028 },
              ],
            },
            computed_at: new Date().toISOString(),
            stale: false,
          },
          running: {
            status: 'ok',
            data: { campaign: null },
            computed_at: new Date().toISOString(),
            stale: false,
          },
        },
      },
    }),
  );
  await page.goto('/w/demo');
  await expect(page.getByRole('heading', { name: 'Kliklo' })).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-prehled-projektu.png`, fullPage: true });
});

test('snímek časové osy kontaktu', async ({ page }) => {
  await ensureSession(page);
  await page.route('**/api/v1/contacts/*/timeline*', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: '1',
            occurred_at: '2026-07-31T14:42:00.000Z',
            source: 'email',
            type: 'message_clicked',
            title: 'Klikla na Zobrazit nabídku v kampani Letní výprodej',
          },
          {
            id: '2',
            occurred_at: '2026-07-31T14:41:00.000Z',
            source: 'email',
            type: 'message_opened',
            title: 'Otevřela kampaň Letní výprodej',
            reliability: 'machine',
          },
          {
            id: '3',
            occurred_at: '2026-07-30T18:20:00.000Z',
            source: 'web',
            type: 'page_view',
            title: 'Zobrazila stránku',
            session_id: 's1',
          },
          {
            id: '4',
            occurred_at: '2026-07-30T18:19:00.000Z',
            source: 'web',
            type: 'page_view',
            title: 'Zobrazila stránku',
            session_id: 's1',
          },
          {
            id: '5',
            occurred_at: '2026-07-29T09:00:00.000Z',
            source: 'contact',
            type: 'contact_created',
            title: 'Byla přidána do kontaktů',
          },
        ],
        contact: { gender: 'female' },
        pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
      },
    }),
  );
  await page.goto('/w/demo/contacts/k1/timeline');
  await expect(page.getByRole('heading', { name: 'Časová osa' })).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-casova-osa.png`, fullPage: true });
});

test('snímek statistik, vývoj v čase', async ({ page }) => {
  const at = (month: string) => `2026-${month}-01T10:00:00.000Z`;
  await ensureSession(page);
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 90,
        computed_at: new Date().toISOString(),
        tiles: {
          recent_campaigns: {
            status: 'ok',
            computed_at: new Date().toISOString(),
            stale: false,
            data: {
              items: [
                {
                  campaignId: 'a',
                  name: 'Duben',
                  startedAt: at('04'),
                  sent: 1010,
                  delivered: 1000,
                  deliveredEffective: 1000,
                  opens: 500,
                  opensApple: 200,
                  clicks: 40,
                  unsubscribed: 5,
                },
                {
                  campaignId: 'b',
                  name: 'Květen',
                  startedAt: at('05'),
                  sent: 2050,
                  delivered: 2000,
                  deliveredEffective: 2000,
                  opens: 900,
                  opensApple: 300,
                  clicks: 100,
                  unsubscribed: 6,
                },
                {
                  campaignId: 'c',
                  name: 'Červen',
                  startedAt: at('06'),
                  sent: 2100,
                  delivered: 2050,
                  deliveredEffective: 2050,
                  opens: 1000,
                  opensApple: 400,
                  clicks: 150,
                  unsubscribed: 4,
                },
              ],
            },
          },
        },
      },
    }),
  );
  await page.goto('/w/demo/stats/campaigns');
  await expect(page.getByRole('heading', { name: 'Vývoj v čase' })).toBeVisible();
  // Graf se načítá líně (kritérium 82), takže se na něj počká. Bez toho
  // by snímek zachytil obrazovku ještě bez grafu a nic by to neprozradilo.
  await expect(page.getByRole('button', { name: 'Zobrazit tabulku hodnot' })).toBeVisible();
  await page.screenshot({ path: `${DIR}/p14-statistiky-vyvoj.png`, fullPage: true });
});
