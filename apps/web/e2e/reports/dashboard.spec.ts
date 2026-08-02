import { expect, test } from '@playwright/test';
import { SPACE, ensureSession } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

const OK = (data: Record<string, unknown>) => ({
  status: 'ok',
  data,
  computed_at: new Date().toISOString(),
  stale: false,
});

test('selhání jedné dlaždice nezhroutí přehled (kritérium 24)', async ({ page }) => {
  await ensureSession(page);
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 30,
        computed_at: new Date().toISOString(),
        tiles: {
          sent: OK({ value: 48320 }),
          click_rate: OK({ rate: 0.038, delta: 0.004 }),
          open_rate: OK({ rate: 0.241, machineShare: 0.41 }),
          problems: OK({ bounceRate: 0.009, complaintRate: 0.0004, level: 'ok' }),
          web_active: { status: 'error', code: 'tile_unavailable' },
          recent_campaigns: OK({ items: [] }),
          running: OK({ campaign: null }),
        },
      },
    }),
  );
  await page.goto('/w/demo');
  await expect(page.getByText(new RegExp(`3,8${SPACE}%`))).toBeVisible();
  // Počítá se jen obsah přehledu. Skořápka má vlastní oblast s `role="alert"`
  // (systémový pruh) a ta s dlaždicemi nesouvisí.
  await expect(page.locator('#main').getByRole('alert')).toHaveCount(1);
});

test('hlavní číslo přehledu je proklik, otevření je menší a s podílem automatických', async ({
  page,
}) => {
  await ensureSession(page);
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 30,
        computed_at: new Date().toISOString(),
        tiles: {
          sent: OK({ value: 100 }),
          click_rate: OK({ rate: 0.038, delta: null }),
          open_rate: OK({ rate: 0.241, machineShare: 0.41 }),
          problems: OK({ bounceRate: 0, complaintRate: 0, level: 'ok' }),
          web_active: OK({ contacts: 34 }),
          recent_campaigns: OK({ items: [] }),
          running: OK({ campaign: null }),
        },
      },
    }),
  );
  await page.goto('/w/demo');
  const clicks = page.getByRole('heading', { name: 'Kliklo' });
  await expect(clicks).toBeVisible();
  await expect(page.getByText(new RegExp(`41${SPACE}% automatických`))).toBeVisible();
});
