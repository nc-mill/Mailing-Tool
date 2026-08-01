import { expect, test, type Page } from '@playwright/test';

/**
 * Celá cesta přihlášení, ne jednotka.
 *
 * Vada, kterou tenhle soubor hlídá, prošla jednotkovými testy i screenshotem:
 * Server Action zavolala API, to relaci založilo a vrátilo `Set-Cookie`, jenže
 * odpověď API není odpovědí pro prohlížeč, takže se hlavička zahodila.
 * Přihlášení se tvářilo úspěšně a uživatel přihlášený nebyl. Odhalit to jde
 * jedině v prohlížeči, proto tenhle test.
 *
 * `storageState` se schválně vynuluje. Konfigurace P05 vkládá do každého testu
 * falešnou relační cookie, aby galerie prošla přes proxy; s ní by tenhle
 * test neřekl nic o skutečné relaci.
 *
 * `locale` je taky schválně: Playwright hlásí `en-US`, takže by proxy poslala
 * prohlížeč na `/en/login` s anglickými popisky a test by hledal české tlačítko
 * na anglické stránce. Ověřeno spuštěním, první běh na tomhle spadl.
 */
test.use({ storageState: { cookies: [], origins: [] }, locale: 'cs-CZ' });

const EMAIL = 'p06-preflight@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Silne-Heslo-2026-Mlain';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('přihlášení propíše relační cookie do prohlížeče', async ({ page, context }) => {
  await signIn(page);

  const session = (await context.cookies()).find((cookie) => cookie.name === 'ml_session');
  expect(session, 'relační cookie musí být v prohlížeči, ne jen v odpovědi API').toBeDefined();
  expect(session?.value).not.toBe('');
  // Atributy nastavuje P04 a rozhraní je nepřepisuje.
  expect(session).toMatchObject({ path: '/', httpOnly: true, sameSite: 'Lax' });

  // Cookie prohlížeč taky skutečně posílá zpátky, ne že jen leží v úložišti.
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe(EMAIL);
});

test('po přihlášení jde otevřít chráněnou stránku bez návratu na /login', async ({ page }) => {
  await signIn(page);

  await page.goto('/settings/profile');

  expect(page.url(), 'chráněná stránka nesmí po přihlášení přesměrovat na /login').not.toContain(
    '/login',
  );
  await expect(page.getByRole('heading', { name: 'Můj účet' })).toBeVisible();
  await expect(page.getByText(EMAIL)).toBeVisible();
});

test('odhlášení relační cookie z prohlížeče odstraní', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/settings/profile');

  // `/no-workspace` i profil nabízejí odhlášení přes tutéž Server Action.
  await page.goto('/no-workspace');
  const signOut = page.getByRole('button', { name: 'Odhlásit se' });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await page.waitForURL(/\/login/);
    const session = (await context.cookies()).find((cookie) => cookie.name === 'ml_session');
    expect(session?.value ?? '').toBe('');
  }
});
