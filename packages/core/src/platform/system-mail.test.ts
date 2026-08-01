import { describe, it, expect } from 'vitest';
import { LoggingSystemMailer, queueSystemMail, setSystemMailer } from './system-mail';

/**
 * Port nesahá na databázi, ale `LoggingSystemMailer` čte úroveň logu
 * z konfigurace. Minimální prostředí pro `loadConfig()` je proto součástí
 * testu; bez něj by první `send()` skončil na `ConfigError`.
 */
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATABASE_URL'] ??= 'postgres://mlain_app:mlain_app@127.0.0.1:5432/mlain';
process.env['DATA_DIR'] ??= '/tmp';
process.env['MODE'] = 'web';
// Bez migrátorské URL vyžaduje křížová kontrola konfigurace MIGRATE_ON_START=false.
process.env['MIGRATE_ON_START'] ??= 'false';

describe('port systémových e-mailů', () => {
  it('výchozí implementace nikdy nehází', async () => {
    await expect(
      new LoggingSystemMailer().send({
        template: 'password_reset',
        to: 'petr@example.cz',
        locale: 'cs',
        data: { url: 'https://example.cz/reset?token=x' },
      }),
    ).resolves.toBeUndefined();
  });

  it('setSystemMailer přesměruje odesílání', async () => {
    const sent: unknown[] = [];
    setSystemMailer({
      async send(mail) {
        sent.push(mail);
      },
    });
    await queueSystemMail({ template: 'invitation', to: 'a@b.cz', locale: 'cs', data: {} });
    expect(sent).toHaveLength(1);
    setSystemMailer(new LoggingSystemMailer());
  });
});
