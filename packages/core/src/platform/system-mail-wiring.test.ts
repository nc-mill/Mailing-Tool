import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hlídač zapojení, ne hlídač chování.
 *
 * Nálezy I71 a I72 popisují týž tvar vady čtyřikrát: modul existuje, má zelené
 * testy a nikdo ho nevolá. `setSystemMailer` byla přesně tenhle případ. Jednotkový
 * test portu byl celou dobu zelený, protože měřil, že port zavolá to, co mu kdo
 * podstrčí; o tom, jestli mu někdo něco podstrčí, nevypovídal nic.
 *
 * Tenhle test proto NEMĚŘÍ odesílání. Měří, že kompoziční kořeny procesů, ve
 * kterých systémová pošta vzniká, odesílatele zapojují. Kdo ten řádek smaže,
 * dozví se to tady, ne až tím, že si někdo neobnoví heslo.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');

const ENTRYPOINTS = [
  // Web: obnova hesla, změna hesla, pozvánka, ověření adresy zkušebního režimu.
  'apps/web/src/instrumentation.ts',
  // Worker: upozornění na vypnutý webhook, které vzniká v jobu platform.webhook_deliver.
  'apps/worker/src/main.ts',
];

describe('zapojení systémové pošty', () => {
  it.each(ENTRYPOINTS)('%s zapojuje odesílatele při startu procesu', (relative) => {
    const source = readFileSync(resolve(ROOT, relative), 'utf8');
    expect(
      source.includes('installSystemMailer'),
      `${relative} nevolá installSystemMailer, systémová pošta z tohohle procesu nikam nepůjde`,
    ).toBe(true);
  });

  it('výchozí odesílatel procesu je pořád ten logující, dokud se nezapojí skutečný', async () => {
    process.env['APP_URL'] ??= 'https://mlain.test';
    process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
    process.env['DATABASE_URL'] ??= 'postgres://mlain_app:mlain_app@127.0.0.1:5432/mlain';
    process.env['DATA_DIR'] ??= '/tmp';
    process.env['MODE'] = 'web';
    process.env['MIGRATE_ON_START'] ??= 'false';

    const { currentSystemMailer, LoggingSystemMailer, setSystemMailer } =
      await import('./system-mail');
    const { installSystemMailer, resetSystemMailerInstallation } =
      await import('./system-mail-runtime');
    const { DefaultSystemMailer } = await import('./system-mailer');

    setSystemMailer(new LoggingSystemMailer());
    resetSystemMailerInstallation();
    expect(currentSystemMailer()).toBeInstanceOf(LoggingSystemMailer);

    installSystemMailer();
    expect(currentSystemMailer()).toBeInstanceOf(DefaultSystemMailer);

    setSystemMailer(new LoggingSystemMailer());
    resetSystemMailerInstallation();
  });
});
