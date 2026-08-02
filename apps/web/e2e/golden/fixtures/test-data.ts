import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ADMIN = {
  name: 'Jana Nováková',
  email: 'jana@firma.cz',
  password: 'ukazkove-heslo-2026',
  locale: 'Čeština',
} as const;

export const PROJECT = {
  name: 'E-shop Kolo',
  emailLocale: 'Čeština',
  timezone: 'Europe/Prague',
  addressForm: 'Vykáním',
} as const;

/** Adresa, kterou test ověří ve zkušebním režimu a na kterou kampaň skutečně odejde. */
export const VERIFIED_RECIPIENT = 'overena@firma.cz';

export const SMTP = {
  /** Jméno účtu v seznamu. Skutečný dialog ho vyžaduje, plán s ním nepočítal. */
  accountName: 'Poštovní past',
  host: 'mailpit',
  // Port se VYBÍRÁ ze čtyř nabízených hodnot, nevyplňuje se. Past proto uvnitř
  // sítě poslouchá na 587, viz komentář v `compose.e2e.yml`.
  port: '587',
  encryption: 'Žádné',
  username: 'test',
  password: 'test',
  fromAddress: 'newsletter@firma.cz',
} as const;

export const CAMPAIGN = {
  name: 'Zlatá cesta: první kampaň',
  subject: 'Vítejte u nás',
  segmentName: 'Aktivní za 90 dní',
  templateName: 'Zlatá cesta: šablona',
} as const;

/**
 * Kořen repozitáře.
 *
 * DOPLNĚK NAD PLÁN, vynucený spuštěním. Plán píše cesty ke compose i k CSV
 * relativně ke kořeni (`docker/compose.yml`), jenže Playwright běží
 * s pracovním adresářem u své konfigurace, tedy v `apps/web`. Doslovný výstup
 * prvního běhu:
 *   Error: Command failed: docker compose -f docker/compose.yml …
 *   open /Users/…/Mailing_Tool/apps/web/docker/compose.yml: no such file or directory
 * Global setup tím spadne dřív, než se pustí první scénář.
 */
export const REPO_ROOT = ((): string => {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Kořen repozitáře se nenašel.');
    dir = parent;
  }
})();

export const CONTACTS_CSV = join(REPO_ROOT, 'apps/web/e2e/golden/fixtures/contacts-50.csv');

/**
 * Prostředí pro každé volání `docker compose`.
 *
 * DOPLNĚK NAD PLÁN, vynucený spuštěním. `docker/compose.yml` má
 * `APP_URL: ${APP_URL:?APP_URL je povinná}` a `SECRET_KEY: ${SECRET_KEY:?...}`,
 * a interpolace se vyhodnocuje u KAŽDÉHO podpříkazu, tedy i u `logs`, `exec`
 * a `down`. Bez těch proměnných skončí i obyčejné čtení logu na
 *   `error while interpolating services.app.environment.APP_URL:
 *    required variable APP_URL is missing a value`
 * a pád se tváří jako chyba testu, ne jako chybějící proměnná. Ověřeno
 * spuštěním. Hodnoty z prostředí mají přednost, tohle jsou jen zálohy.
 */
/** Adresa, na které instalace v testu poslouchá. Sem míří i banner z entrypointu. */
export const APP_URL: string =
  process.env.APP_URL ?? process.env.MLAIN_E2E_BASE_URL ?? 'http://localhost:3000';

export const COMPOSE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  APP_URL,
  APP_PORT: process.env.APP_PORT ?? '3000',
  // Celá adresa, ne holý host: sender v Go vyžaduje schéma, viz komentář
  // v `compose.e2e.yml`.
  TRACKING_DOMAIN: process.env.TRACKING_DOMAIN ?? APP_URL,
  MAILPIT_HTTP_PORT: process.env.MAILPIT_HTTP_PORT ?? '8025',
  MAILPIT_SMTP_PORT: process.env.MAILPIT_SMTP_PORT ?? '1025',
  // Testovací klíč. Instalace v E2E vzniká a zaniká s během, takže je veřejný
  // schválně: kdyby si ho někdo měl generovat, přestane být běh opakovatelný.
  SECRET_KEY: process.env.SECRET_KEY ?? '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};
