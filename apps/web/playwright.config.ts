import { SESSION_COOKIE_NAME } from '@mlain/core/identity/cookie';
import { defineConfig, devices } from '@playwright/test';

/**
 * Konfiguraci vlastní P05, protože je první plán, který potřebuje
 * prohlížeč. Pozdější plány přidávají spec soubory do vlastních
 * podadresářů `e2e/<oblast>/` a konfiguraci nemění.
 *
 * PORT SE ODVOZUJE, NEPÍŠE SE NATVRDO, a je to oprava konkrétní vady.
 *
 * Původně tu byl na třech místech pevně `3000`, zatímco vývojový server běžel
 * podle `APP_URL` na `3100`. `reuseExistingServer` proto nikdy nezabral: hlídal
 * port, na kterém nikdo neposlouchal, takže si Playwright pokaždé pustil
 * DRUHÝ vývojový server nad týmž adresářem `.next`.
 *
 * Následek byl zákeřný, protože nic nespadlo. Dva servery si přepisovaly
 * buildové artefakty, prohlížeč dostal nesourodou sadu chunků a klientský
 * runtime se vůbec nerozjel. Stránky vracely 200, serverové HTML se vykreslilo,
 * v konzoli nebyla výjimka, jen se nenamountoval React. Procházely testy, které
 * kontrolují obsah, a padaly výhradně ty, které potřebují kliknutí nebo klávesu.
 * To svádělo hledat chybu v komponentách, které s tím neměly nic společného.
 *
 * Se sladěným portem se běžící server znovu použije a druhý nevznikne.
 */
// `.env.local` si načítá Next sám, ale tenhle konfigurák běží ve vlastním
// procesu, kam se nic z něj nedostane. Bez tohohle řádku by `APP_URL` chybělo,
// spadlo by se na výchozí 3000 a celý rozchod portů by se vrátil.
// Soubor nemusí existovat (CI, čerstvý checkout), pak platí výchozí hodnota.
try {
  process.loadEnvFile(new URL('./.env.local', import.meta.url));
} catch {
  // Nic. Chybějící soubor je legitimní stav, ne chyba.
}

const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
const port = Number(new URL(appUrl).port || '3000');

/**
 * HOSTNAME SE TAKY ODVOZUJE, a taky kvůli konkrétní vadě.
 *
 * Původně tu bylo `127.0.0.1`, zatímco `APP_URL` říká `localhost`. Pro Next 16
 * to nejsou synonyma: dev zdroje pod `_next` obsluhuje jen pro origin uvedený
 * v `allowedDevOrigins`, a jiný origin dostane místo websocket handshaku
 * obyčejnou HTTP odpověď. V konzoli to je
 *
 *   WebSocket connection to 'ws://127.0.0.1:3100/_next/webpack-hmr' failed:
 *   Error during WebSocket handshake: net::ERR_INVALID_HTTP_RESPONSE
 *
 * a klientský runtime se kvůli tomu vůbec nerozjede. Naměřeno přímo: táž
 * stránka přes `localhost` má na `documentElement` klíče `__reactFiber$`
 * a čistou konzoli, přes `127.0.0.1` nemá ani jeden a React se nenamountuje.
 *
 * Přes `127.0.0.1` proto procházely testy, které kontrolují jen obsah, a padaly
 * výhradně ty, které potřebují kliknutí nebo klávesu. Vypadalo to jako vada
 * komponent, přitom komponenty nikdy nedostaly šanci se spustit.
 */
const hostname = new URL(appUrl).hostname;
const localUrl = `http://${hostname}:${port}`;

export default defineConfig({
  testDir: './e2e',
  // Zlatá cesta se odsud VYLUČUJE.
  //
  // `e2e/golden/**` vlastní P16 a má vlastní konfiguraci
  // (`playwright.golden.config.ts`) s jedním workerem, delšími limity a
  // global setupem, který zvedá `docker compose` s poštovní pastí. Bez
  // téhle výjimky si je tahle konfigurace vezme taky, protože leží pod
  // `testDir`, a pustí je podruhé proti holému dev serveru, kde spadnou
  // na nedostupném compose. Změřeno: `playwright test --list` vypisoval
  // 55 testů v 11 souborech místo 39 v 6, včetně všech šestnácti scénářů
  // zlaté cesty. Červená by se pak přičetla zlaté cestě, přestože vada je
  // v rozsahu téhle konfigurace.
  testIgnore: '**/golden/**',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? localUrl,
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
          // Musí sedět s hostname v `baseURL`, jinak prohlížeč cookie k požadavku
          // nepřipojí, proxy nikoho nepustí dál a galerie skončí na /login.
          domain: hostname,
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
        // Port se předává explicitně. Bez něj vezme `next dev` výchozí 3000
        // bez ohledu na to, co hlídá `url`, a rozejde se to znovu.
        command: `pnpm --filter @mlain/web exec next dev --port ${port}`,
        url: localUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
