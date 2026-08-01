import { expect, type Page } from '@playwright/test';

/**
 * Kam testy editoru míří a čím se přihlásí.
 *
 * ODCHYLKA OD PLÁNU. Plán počítal s ukázkovou šablonou `tmpl-demo` v projektu
 * `demo` a s tím, že si ji test v nouzi založí přes `POST /api/v1/templates`.
 * Ani jedno dnes neexistuje: ukázková data vlastní P16 a router v
 * `apps/web/src/lib/api` **žádný endpoint šablon nemá** (otevřené požadavky
 * P08-R2 a P08-R5 v kapitole 9.2 plánu). Adresa se proto bere z prostředí
 * a bez ní se testy přeskočí, místo aby padaly na chybějícím cizím díle.
 *
 * Spuštění proti běžícímu vývojovému serveru:
 *
 * ```bash
 * E2E_BASE_URL=http://localhost:3100 \
 * E2E_EDITOR_PATH=/cs/w/<projekt>/templates/<id> \
 * E2E_EMAIL=dev@mlain.test E2E_PASSWORD=… \
 *   pnpm --filter @mlain/web exec playwright test e2e/editor --workers=1
 * ```
 *
 * Místo hesla jde předat hotovou relaci v `E2E_SESSION_COOKIE` ve tvaru
 * `jmeno=hodnota`. Přihlašovací endpoint má limit počtu pokusů a při opakovaných
 * bězích proti jednomu vývojovému serveru se vyčerpá; test pak spadne na 429
 * a vypadá to jako chyba editoru, přestože jde o obranu proti hádání hesla.
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000';
export const EDITOR_PATH = process.env['E2E_EDITOR_PATH'] ?? '';
const EMAIL = process.env['E2E_EMAIL'] ?? '';
const PASSWORD = process.env['E2E_PASSWORD'] ?? '';
const SESSION = process.env['E2E_SESSION_COOKIE'] ?? '';

export const editorConfigured =
  EDITOR_PATH !== '' && (SESSION !== '' || (EMAIL !== '' && PASSWORD !== ''));

export const SKIP_REASON =
  'Nastav E2E_EDITOR_PATH a k tomu E2E_EMAIL s E2E_PASSWORD, nebo E2E_SESSION_COOKIE. Ukázkovou šablonu vlastní P16, endpointy šablon P08.';

type Cookie = Parameters<Awaited<ReturnType<Page['context']>>['addCookies']>[0][number];

/** Přihlášení se dělá jednou za proces, další testy dostanou hotovou cookie. */
let cachedCookies: Cookie[] | null = null;

/**
 * Přihlášení přes formulář, ne přes podvrženou cookie. Konfigurace P05 vkládá
 * cookie s nesmyslnou hodnotou, která projde jen přes `proxy.ts`; serverová
 * komponenta editoru se ale ptá skutečného API a to takovou relaci odmítne.
 */
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

export async function openEditor(page: Page): Promise<void> {
  await signIn(page);
  await page.goto(EDITOR_PATH);
  await expect(page.getByRole('tree')).toBeVisible({ timeout: 120_000 });
}

/**
 * Dojde na plátno **jen Tabem**. Plán psal jediný `Tab`, jenže před plátnem je
 * skořápka aplikace: odkaz na přeskočení obsahu, přepínač projektu, hledání
 * a nápověda. Kritérium 54 mluví o tom, že se na blok dá dostat bez myši,
 * ne o tom, kolikátý tabstop to je, takže se tabuje, dokud fokus není na bloku.
 */
export async function tabToCanvas(page: Page): Promise<void> {
  // Před plátnem stojí skořápka i celá paleta bloků, takže tabstopů je přes
  // třicet. Strop je proto velkorysý; jde o to, že cesta existuje.
  for (let step = 0; step < 80; step += 1) {
    const onBlock = await page.evaluate(
      () => document.activeElement?.getAttribute('role') === 'treeitem',
    );
    if (onBlock) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Na plátno se nedá dostat Tabem, což porušuje kritérium 54.');
}
