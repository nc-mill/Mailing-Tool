import { expect, test } from '@playwright/test';
import { SPACE, STATS, ensureSession, stubReportApi } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

test('kampaň s vypnutým měřením ukáže vysvětlení, ne nuly (kritérium 60)', async ({ page }) => {
  await stubReportApi(page, { track_opens: false, track_clicks: false });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Měření otevření bylo pro tuto kampaň vypnuté')).toBeVisible();
  await expect(page.getByText('Měření prokliků bylo pro tuto kampaň vypnuté')).toBeVisible();
  await expect(page.getByText('0 ověřených')).toHaveCount(0);
});

test('koncept ukáže cestu k editaci, ne prázdný report', async ({ page }) => {
  await stubReportApi(page, { status: 'draft' });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Report bude dostupný po odeslání kampaně.')).toBeVisible();
});

test('odesílaná kampaň ukáže pruh s průběhem', async ({ page }) => {
  await stubReportApi(page, {
    status: 'sending',
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
  await expect(page.getByText(new RegExp(`428 z 1${SPACE}129`))).toBeVisible();
});

test('chyba načtení ukáže kód a request_id pod podrobnostmi (kritérium 22)', async ({ page }) => {
  await ensureSession(page);
  await page.route('**/api/v1/campaigns/*/stats', (route) =>
    route.fulfill({ status: 500, json: { code: 'internal_error', request_id: 'req-42' } }),
  );
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByText('Diagnostika').click();
  await expect(page.getByText(/req-42/)).toBeVisible();
});
