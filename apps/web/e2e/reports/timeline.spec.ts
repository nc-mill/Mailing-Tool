import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ensureSession } from './fixtures';

/**
 * Testy reportů kontrolují ČESKÉ znění, takže musí běžet v češtině.
 * Playwright posílá ve výchozím stavu `Accept-Language: en-US` a `proxy.ts`
 * podle toho přepne aplikaci na `/en/...`, kde je všechen text anglicky.
 * Bez tohohle řádku testy padaly na textech, ne na chování.
 */
test.use({ locale: 'cs-CZ' });

const ITEMS = [
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
    occurred_at: '2026-07-30T18:18:00.000Z',
    source: 'automation',
    type: 'automation_entered',
    title: 'Vstup do automatizace',
  },
];

test.beforeEach(async ({ page }) => {
  await ensureSession(page);
  await page.route('**/api/v1/contacts/*/timeline*', (route) =>
    route.fulfill({
      json: {
        data: ITEMS,
        // Rod skládá věty na serveru, klient ho jen předá komponentě K8.
        contact: { gender: 'female' },
        pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 },
      },
    }),
  );
  await page.goto('/w/demo/contacts/k1/timeline');
});

test('věty jsou skloňované podle rodu a automatické otevření je označené', async ({ page }) => {
  await expect(page.getByText('Klikla na Zobrazit nabídku v kampani Letní výprodej')).toBeVisible();
  await expect(page.getByText(/Automatické stažení poštovním klientem/)).toBeVisible();
});

test('webová série jedné návštěvy je jeden rozbalitelný řádek', async ({ page }) => {
  await expect(page.getByText(/Návštěva webu, 2 stránky/)).toBeVisible();
});

test('neznámý typ položky obrazovku nerozbije', async ({ page }) => {
  await expect(page.getByText('Vstup do automatizace')).toBeVisible();
});

test('osa nemá vážné prohřešky proti přístupnosti', async ({ page }) => {
  // Měří se obsah osy, ne skořápka kolem něj, viz report.spec.ts.
  //
  // NÁLEZ NA P05, ne na P14: kontejner toastů v `packages/ui/src/patterns/toast/
  // toast-provider.tsx` má `aria-label` na `div` bez role, což axe hlásí jako
  // vážné porušení `aria-prohibited-attr`. Je uvnitř `#main`, takže ho zúžení
  // rozsahu nevyloučí, a s časovou osou nemá nic společného.
  const results = await new AxeBuilder({ page })
    .include('#main')
    .exclude('.pointer-events-none')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
});
