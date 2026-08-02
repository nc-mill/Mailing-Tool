import type { Page } from '@playwright/test';

/**
 * Kam testy AI míří a čím se přihlásí.
 *
 * Stejný přístup jako u editoru: ukázková data vlastní P16 a projekt `demo`
 * v tomhle repozitáři nemusí existovat, takže se slug bere z prostředí a bez
 * něj se testy přeskočí, místo aby padaly na chybějícím cizím díle.
 *
 * ```bash
 * E2E_BASE_URL=http://localhost:3100 \
 * E2E_WORKSPACE_SLUG=preflight-projekt \
 * E2E_EMAIL=dev@mlain.test E2E_PASSWORD=… \
 *   pnpm --filter @mlain/web exec playwright test e2e/ai --workers=1
 * ```
 *
 * Místo hesla jde předat hotovou relaci v `E2E_SESSION_COOKIE` ve tvaru
 * `jmeno=hodnota`. Přihlašovací endpoint má limit počtu pokusů a při opakovaných
 * bězích proti jednomu vývojovému serveru se vyčerpá; test pak spadne na 429
 * a vypadá to jako chyba obrazovky.
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000';
export const WORKSPACE_SLUG = process.env['E2E_WORKSPACE_SLUG'] ?? '';
export const EDITOR_PATH = process.env['E2E_EDITOR_PATH'] ?? '';
const EMAIL = process.env['E2E_EMAIL'] ?? '';
const PASSWORD = process.env['E2E_PASSWORD'] ?? '';
const SESSION = process.env['E2E_SESSION_COOKIE'] ?? '';

const hasIdentity = SESSION !== '' || (EMAIL !== '' && PASSWORD !== '');

export const aiConfigured = WORKSPACE_SLUG !== '' && hasIdentity;
export const editorConfigured = EDITOR_PATH !== '' && hasIdentity;

export const SKIP_REASON =
  'Nastav E2E_WORKSPACE_SLUG a k tomu E2E_EMAIL s E2E_PASSWORD, nebo E2E_SESSION_COOKIE. Ukázkový projekt vlastní P16.';

export const SKIP_EDITOR_REASON =
  'Nastav E2E_EDITOR_PATH a přihlašovací údaje. Ukázkovou šablonu vlastní P16.';

export const aiSettingsPath = (): string => `/cs/w/${WORKSPACE_SLUG}/settings/ai`;
export const brandSettingsPath = (): string => `/cs/w/${WORKSPACE_SLUG}/settings/brand`;

type Cookie = Parameters<Awaited<ReturnType<Page['context']>>['addCookies']>[0][number];

let cachedCookies: Cookie[] | null = null;

/** Přihlášení přes formulář, ne přes podvrženou cookie: serverová komponenta se ptá skutečného API. */
export async function signIn(page: Page): Promise<void> {
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    return;
  }
  if (SESSION !== '') {
    const separator = SESSION.indexOf('=');
    cachedCookies = [
      {
        name: SESSION.slice(0, separator),
        value: SESSION.slice(separator + 1),
        domain: new URL(BASE_URL).hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ];
    await page.context().addCookies(cachedCookies);
    return;
  }
  await page.goto('/cs/login');
  await page.locator('input[name=email]').fill(EMAIL);
  await page.locator('input[name=password]').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 60_000 }),
    page.getByRole('button', { name: 'Přihlásit se' }).click(),
  ]);
  cachedCookies = await page.context().cookies();
}
