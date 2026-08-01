import { SESSION_COOKIE_NAME } from '@mlain/core/identity/cookie';
import { defineConfig, devices } from '@playwright/test';

/**
 * Konfiguraci vlastní P05, protože je první plán, který potřebuje
 * prohlížeč. Pozdější plány přidávají spec soubory do vlastních
 * podadresářů `e2e/<oblast>/` a konfiguraci nemění.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    // Odchylka od plánu: `proxy.ts` (mimo vlastnictví tohohle úkolu) přesměruje
    // každou stránku mimo `ANONYMOUS_PAGES` na /login, dokud nevidí cookie
    // relační cookie, jejíž jméno vlastní identita v P04. Proxy jen kontroluje přítomnost cookie, ne její platnost,
    // a galerie sama žádnou relaci neověřuje, takže tahle falešná cookie stačí
    // na to, aby e2e testy viděly `/ui-gallery` bez skutečného přihlášení.
    storageState: {
      cookies: [
        {
          name: SESSION_COOKIE_NAME,
          value: 'e2e-ui-gallery',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @mlain/web dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
