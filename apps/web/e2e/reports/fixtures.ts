import { SESSION_COOKIE_NAME } from '@mlain/core/identity/cookie';
import type { Page } from '@playwright/test';

/**
 * Falešná relační cookie. `proxy.ts` kontroluje jen PŘÍTOMNOST cookie, ne její
 * platnost, takže tohle stačí na to, aby se testy dostaly za přihlášení.
 *
 * Nastavuje se v testu, ne přes `storageState` z `playwright.config.ts`.
 * Jakmile si soubor přenastaví kontext přes `test.use({ locale })`, vyrobí se
 * nový kontext a cookie z konfigurace v něm nebyla; testy pak místo reportu
 * viděly přihlašovací stránku a padaly na textech.
 */
export async function ensureSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: 'e2e-reports',
      // Doména se ODVOZUJE ze stejného zdroje jako `baseURL`, nepíše se natvrdo.
      // `localhost` a `127.0.0.1` nejsou pro cookie totéž: cookie na jeden
      // z nich se k druhému nepřipojí a proxy pak testy odbaví přesměrováním
      // na přihlášení. Testy pak padají na textech, ne na chování.
      domain: new URL(process.env.E2E_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000')
        .hostname,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

export const STATS = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  counts: {
    materialized: 1153,
    sent: 1153,
    skipped: 0,
    failed: 0,
    delivered: 1141,
    delivered_effective: 1141,
    bounced_hard: 8,
    bounced_soft: 4,
    complained: 1,
    unsubscribed: 4,
    opens_total: 1200,
    opens_unique: 832,
    opens_unique_human: 387,
    opens_unique_apple: 411,
    clicks_total: 210,
    clicks_unique: 190,
    clicks_unique_human: 187,
    clicks_scanner: 20,
  },
  rates: {
    open_rate: 0.729,
    machine_open_share: 0.494,
    verified_open_rate: 0.53,
    click_rate: 0.164,
    click_to_open_rate: 0.483,
    bounce_rate: 0.0104,
    complaint_rate: 0.00088,
    unsubscribe_rate: 0.0035,
  },
  open_breakdown: {
    verified: 387,
    machine: 411,
    uncertain: 34,
    total: 832,
    clicked_from_verified: 187,
  },
  predicted_opens: { low_count: 560, high_count: 640, sample_size: 730 },
  small_sample: false,
  audience_built_at: '2026-07-31T14:38:00.000Z',
  started_at: '2026-07-25T14:38:00.000Z',
  finished_at: '2026-07-25T14:52:00.000Z',
  first_event_at: '2026-07-25T14:39:00.000Z',
  last_event_at: '2026-07-25T18:02:00.000Z',
  version: 42,
  updated_at: '2026-07-25T18:02:00.000Z',
};

/**
 * Mezera, kterou čeští Intl formátovači vkládají do tisíců a před procento,
 * není obyčejná: je to úzká nezlomitelná mezera. Regulární výraz proto musí
 * použít `\s`, ne mezerník. Bez toho by testy padaly na neviditelný rozdíl.
 */
export const SPACE = '\\s?';

export async function stubReportApi(
  page: Page,
  overrides: Partial<typeof STATS> = {},
): Promise<void> {
  await ensureSession(page);
  await page.route('**/api/v1/campaigns/*/stats', (route) =>
    route.fulfill({ json: { ...STATS, ...overrides }, headers: { ETag: 'W/"42"' } }),
  );
  await page.route('**/api/v1/campaigns/*/links', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            link_id: 'l1',
            url: 'https://x.cz/nabidka',
            label: 'Zobrazit nabídku',
            position: 0,
            clicks_total: 142,
            clicks_unique: 112,
            clicks_human: 142,
            share: 0.75,
            duplicate_url: false,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/campaigns/*/stats/timeline*', (route) =>
    route.fulfill({ json: { granularity: '5m', compacted: false, points: [] } }),
  );
  await page.route('**/api/v1/campaigns/*/recipients*', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            message_id: 'm1',
            contact_id: null,
            email: null,
            name: null,
            contact_state: 'deleted',
            first_open_at: '2026-07-25T15:10:00.000Z',
            first_click_at: null,
            open_count: 1,
            click_count: 0,
            open_reliability: 'machine',
          },
          {
            message_id: 'm2',
            contact_id: 'k2',
            email: 'jana@example.cz',
            name: 'Jana Nováková',
            contact_state: 'active',
            first_open_at: '2026-07-25T15:12:00.000Z',
            first_click_at: '2026-07-25T15:13:00.000Z',
            open_count: 3,
            click_count: 1,
            open_reliability: 'confirmed',
          },
        ],
        pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
      },
    }),
  );
}
