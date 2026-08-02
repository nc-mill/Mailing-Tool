import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { APP_URL, COMPOSE_ENV, REPO_ROOT } from '../fixtures/test-data';
import { SetupPage } from '../pages/setup.page';

const run = promisify(execFile);
const COMPOSE = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
];

test('krok 0: výpis kontejneru řekne, kam jít a co udělat', async () => {
  // Požadavek U→1.9 části 6 a rozhraní I→P01.5. Banner vlastní entrypoint P01,
  // tenhle test ho vynucuje.
  const logs = await run('docker', [...COMPOSE, 'logs', '--no-color', 'app'], {
    maxBuffer: 32e6,
    env: COMPOSE_ENV,
    cwd: REPO_ROOT,
  });
  expect(logs.stdout).toContain('Mlain Mailer je připravený');
  // Adresa se bere z `APP_URL`, ne natvrdo. Plán tu má `http://localhost:3000`,
  // jenže port je parametrizovaný, protože na vývojářském stroji běží souběžně
  // víc instalací. Natvrdo zapsaný port by na jiném portu hlásil pád banneru,
  // přestože banner je v pořádku, a nález by se přičetl špatnému plánu.
  expect(logs.stdout).toContain(APP_URL);
  expect(logs.stdout).toMatch(/Účet správce si založíte na první obrazovce/);
});

test('registrace je otevřená jen dokud neexistuje první uživatel', async ({ page, request }) => {
  await page.goto('/setup');
  await expect(page.getByText(/Instalace je zatím otevřená/)).toBeVisible();

  const setup = new SetupPage(page);
  await setup.createAdminAndProject();

  const second = await request.post('/api/v1/setup', {
    data: { email: 'druhy@firma.cz', password: 'jine-heslo-2026', name: 'Druhý' },
  });
  expect(second.status()).toBe(409);
  expect(((await second.json()) as { code?: string }).code).toBe('setup_already_completed');
});

test('přihlašovací stránka nabízí obnovu hesla z příkazové řádky', async ({ page }) => {
  // Požadavek U→1.8 a rozhraní I→P06.1.
  await page.goto('/login');
  await expect(page.getByText(/Odesílání ještě není nastavené/)).toBeVisible();
});

test('mlain reset-password vrátí přístup do zamčené instalace', async ({ page }) => {
  const result = await run(
    'docker',
    [...COMPOSE, 'exec', '-T', 'app', 'mlain', 'reset-password', 'jana@firma.cz'],
    { env: COMPOSE_ENV, cwd: REPO_ROOT },
  );
  const password = result.stdout.match(/\n\n {2}(\S+)\n/)?.[1];
  expect(password).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('E-mail').fill('jana@firma.cz');
  await page.getByLabel('Heslo').fill(password!);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/w\//);
});

test('obrazovky P16 nemají závažné prohřešky proti přístupnosti', async ({ page }) => {
  for (const path of ['/setup', '/login']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
  }
});
