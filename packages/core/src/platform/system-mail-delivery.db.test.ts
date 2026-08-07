import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Prostředí musí být hotové DŘÍV, než se natáhne cokoliv, co volá `loadConfig()`.
 * Testovací databázi doplní globální setup, tohle je zbytek minima.
 */
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATA_DIR'] ??= '/tmp';
process.env['MODE'] = 'web';
process.env['MIGRATE_ON_START'] ??= 'false';

const { withTestWorkspace } = await import('../campaigns/test/harness');
const { rawSql } = await import('../campaigns/repo/raw-sql');
const { withWorkspace, withoutContext } = await import('../tx');
const { readInstallationSystemMailWorkspace, rememberInstallationSystemMailWorkspace } =
  await import('./system-mail-installation');
const { encryptProviderConfig } = await import('../providers/crypto');
const { queueSystemMail } = await import('./system-mail');
const { installSystemMailer, resetSystemMailerInstallation } =
  await import('./system-mail-runtime');
const { SystemMailNotConfiguredError } = await import('./system-mailer');

/**
 * Poštovní past. Výchozí adresa míří na kontejner, který si test NEZAKLÁDÁ:
 * `docker run -d --name mlain-syscheck-mailpit -p 2525:1025 -p 8225:8025 axllent/mailpit:v1.21`
 *
 * Bez pasti se test PŘESKOČÍ, nespadne. Důvod je konkrétní: je to jediný test
 * v balíčku závislý na službě mimo databázi, a červená série kvůli chybějícímu
 * kontejneru by lidi naučila červenou sérii ignorovat.
 */
const MAILPIT_HTTP = process.env['MLAIN_SYSMAIL_MAILPIT_HTTP'] ?? 'http://127.0.0.1:8225';
const MAILPIT_SMTP_PORT = Number(process.env['MLAIN_SYSMAIL_MAILPIT_SMTP_PORT'] ?? 2525);

type MailpitSummary = {
  total: number;
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>;
};

async function mailpitReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${MAILPIT_HTTP}/readyz`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Hledá se podle příjemce, ne mazáním schránky: past může sdílet jiný běh. */
async function waitForMessage(
  recipient: string,
): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const list = (await (
      await fetch(`${MAILPIT_HTTP}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`)
    ).json()) as MailpitSummary;
    const found = list.messages[0];
    if (found) {
      const detail = (await (await fetch(`${MAILPIT_HTTP}/api/v1/message/${found.ID}`)).json()) as {
        Subject: string;
        Text: string;
        HTML: string;
      };
      return { subject: detail.Subject, text: detail.Text, html: detail.HTML };
    }
    if (Date.now() > deadline) {
      throw new Error(`Do pasti nedorazila zpráva pro ${recipient} do limitu.`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function seedSmtpAccount(
  ctx: { workspace: never; workspaceId: string },
  isDefault = true,
): Promise<void> {
  const config = {
    kind: 'smtp' as const,
    host: '127.0.0.1',
    // Schéma odesílacího účtu bere jen 25, 465, 587 a 2525, proto past na 2525.
    port: 2525 as const,
    username: 'test',
    password: 'test',
    encryption: 'none' as const,
    max_send_rate: 10,
    max_connections: 5,
    max_messages_per_connection: 100,
  };
  const stored = encryptProviderConfig({ config, workspaceId: ctx.workspaceId });
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO sending_providers
           (id, workspace_id, name, type, config_encrypted, config_public, status, is_default)
         VALUES ($1, $2, 'Poštovní past', 'smtp', $3, $4::jsonb, 'ready', $5)`,
        [
          randomUUID(),
          ctx.workspaceId,
          stored,
          JSON.stringify({
            kind: 'smtp',
            host: '127.0.0.1',
            port: MAILPIT_SMTP_PORT,
            encryption: 'none',
            username_masked: '****',
          }),
          isDefault,
        ],
      ),
    ),
  );
}

/**
 * DŮKAZ, ŽE SYSTÉMOVÁ POŠTA DOOPRAVDY ODEJDE.
 *
 * `setSystemMailer` existovala od P04 a NIKDO ji nevolal, takže `queueSystemMail`
 * jen zalogovala `system_mail_not_configured` a vrátila úspěch. Zelený jednotkový
 * test portu o tom nevypovídal nic: měřil, že port zavolá to, co mu kdo podstrčí.
 *
 * Tenhle test proto neměří volání. Měří, že zpráva je ve schránce.
 */
describe('systémová pošta dorazí do schránky', () => {
  let available = false;
  beforeAll(async () => {
    available = await mailpitReachable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(`Poštovní past na ${MAILPIT_HTTP} neběží, testy doručení se přeskakují.`);
    }
  });

  /**
   * NEJDŮLEŽITĚJŠÍ TEST V SOUBORU. Modul, ve kterém NIKDO nezavolal
   * `installSystemMailer`, musí poštu odeslat taky.
   *
   * Je to přesně ta situace, na které to v běžícím kontejneru padlo: v Next.js
   * můžou `instrumentation.ts` a obsluha trasy skončit v oddělených modulových
   * grafech, takže každý vidí vlastní kopii proměnné `mailer`. Instrumentation
   * do logu napsala, že odesílatele zapojila, a trasa přesto pořád držela ten
   * logující, což se v logu dev serveru poznalo podle úrovně 40 a přiloženého
   * obsahu zprávy.
   *
   * `vi.resetModules()` se tu POUŽÍT NEDÁ, i když by tu situaci vyrobil doslova:
   * čerstvý graf si otevře i vlastní databázový pool, který nikdo nezavře, a běh
   * pak skončí na „terminating connection due to administrator command", až
   * harness testovou databázi zahodí. Ověřeno spuštěním. Měří se proto ta věc,
   * na které oprava stojí: prázdný odesílatel a to, co se z něj samo sestaví.
   */
  it('odešle i bez zapojení, protože si odesílatele sestaví sám', async () => {
    if (!available) return;
    const ctx = await withTestWorkspace();
    await seedSmtpAccount(ctx as never);

    const { setSystemMailer, currentSystemMailer } = await import('./system-mail');
    resetSystemMailerInstallation();
    setSystemMailer(null);
    expect(currentSystemMailer()).toBeNull();

    const to = `bez-zapojeni-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'invitation',
      to,
      locale: 'cs',
      data: { url: 'https://mlain.test/invitations/accept?token=graf' },
      workspaceId: ctx.workspaceId,
    });

    const message = await waitForMessage(to);
    expect(message.subject).toBe('Pozvánka do projektu');
    expect(message.text).toContain('https://mlain.test/invitations/accept?token=graf');
    // A tohle je ten důkaz: líně sestavený odesílatel je ten skutečný, ne logující.
    expect(currentSystemMailer()?.constructor.name).toBe('DefaultSystemMailer');
  }, 60_000);

  it('ověření adresy zkušebního režimu dorazí i s odkazem na potvrzení', async () => {
    if (!available) return;
    resetSystemMailerInstallation();
    installSystemMailer();

    const ctx = await withTestWorkspace();
    await seedSmtpAccount(ctx as never);

    const to = `trial-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'trial_address_verification',
      to,
      locale: 'cs',
      data: { url: 'https://mlain.test/verify-sender/token-xyz' },
      workspaceId: ctx.workspaceId,
    });

    const message = await waitForMessage(to);
    expect(message.subject).toBe('Potvrzení adresy pro zkušební režim');
    expect(message.text).toContain('https://mlain.test/verify-sender/token-xyz');
    expect(message.html).toContain('href="https://mlain.test/verify-sender/token-xyz"');
  }, 60_000);

  /**
   * Druhé místo ze seznamu, a to nejdůležitější. Obnova hesla NEMÁ projekt:
   * kdo zapomene heslo, není přihlášený a nemusí patřit nikam. Kdyby odesílatel
   * uměl vybrat účet jen podle projektu, prošlo by ověření adresy a obnova hesla
   * by dál mizela, tedy zapojení napůl.
   */
  it('obnova hesla dorazí i bez projektu v nákladu', async () => {
    if (!available) return;
    resetSystemMailerInstallation();
    installSystemMailer();

    const ctx = await withTestWorkspace();
    await seedSmtpAccount(ctx as never);

    const to = `reset-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'password_reset',
      to,
      locale: 'cs',
      data: { url: 'https://mlain.test/reset-password?token=abc123' },
      // ZÁMĚRNĚ bez workspaceId, přesně jak to dělá `identity/password-reset.ts`:
      // projekt se dohledá z uživatele.
      userId: ctx.userId,
    });

    const message = await waitForMessage(to);
    expect(message.subject).toBe('Obnova hesla');
    expect(message.text).toContain('https://mlain.test/reset-password?token=abc123');
  }, 60_000);

  /**
   * Projekt bez odesílacího účtu. Je to stav hned po instalaci, kdy zároveň chodí
   * pozvánky, takže se nesmí přejít mlčky.
   *
   * Měří se to na odesílateli, ne přes `queueSystemMail`. Ta má mimo produkci
   * záchrannou větev, která odkaz dopíše do logu, aby čerstvá vývojová instalace
   * nevracela na obnovu hesla chybu 500; v produkci se výjimka vypustí ven.
   */
  it('bez odesílacího účtu odesílatel spadne nahlas, ne tiše', async () => {
    if (!available) return;
    const { DefaultSystemMailer } = await import('./system-mailer');

    const ctx = await withTestWorkspace();
    // Projekt bez účtu. Ostatní projekty v testovací databázi účet taky nemají,
    // protože si každý test zakládá vlastní čerstvou databázi ze šablony.
    await expect(
      new DefaultSystemMailer().send({
        template: 'invitation',
        to: `pozvanka-${Date.now()}@example.test`,
        locale: 'cs',
        data: { url: 'https://mlain.test/invitations/accept?token=x' },
        workspaceId: ctx.workspaceId,
      }),
    ).rejects.toBeInstanceOf(SystemMailNotConfiguredError);
  }, 60_000);

  /**
   * O účtu rozhoduje `is_default`, ne typ.
   *
   * PŘEDCHOZÍ PODOBA TOHOHLE TESTU MĚŘILA OPAK: „výchozí účet SES nezastíní účet
   * SMTP". Tehdy to bylo správně, protože odsud uměl odeslat jen SMTP a jiná
   * volba by znamenala neodeslanou poštu. Od doplnění větve pro SES odešlou oba
   * typy, takže přednost podle typu by uživateli měnila adresu odesílatele za
   * zády: v nastavení by viděl jako výchozí jeden účet a pošta by chodila
   * z domény druhého.
   */
  it('rozhoduje výchozí účet, ne typ účtu', async () => {
    if (!available) return;
    resetSystemMailerInstallation();
    installSystemMailer();

    const ctx = await withTestWorkspace();
    // Výchozí je past; index `uq_sending_providers__one_default` druhý výchozí nedovolí.
    await seedSmtpAccount(ctx as never, true);
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `INSERT INTO sending_providers
             (id, workspace_id, name, type, config_encrypted, config_public, status, is_default)
           VALUES ($1, $2, 'SES', 'ses', 'enc:test', '{}'::jsonb, 'ready', false)`,
          [randomUUID(), ctx.workspaceId],
        ),
      ),
    );

    const to = `vychozi-ucet-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'trial_address_verification',
      to,
      locale: 'cs',
      data: { url: 'https://mlain.test/verify-sender/vychozi-ucet' },
      workspaceId: ctx.workspaceId,
    });

    const message = await waitForMessage(to);
    expect(message.text).toContain('https://mlain.test/verify-sender/vychozi-ucet');
  }, 60_000);

  /**
   * ROZHODNUTÍ R2 PLÁNU, KONEC NEJHORŠÍHO STAVU: uživatel odebraný z posledního
   * projektu se nedostal k obnově hesla vůbec, protože odesílatel neměl odkud
   * vzít odesílací účet a skončil chybou.
   *
   * Měří se obojí naráz, protože jedno bez druhého nefunguje: že se projekt
   * instalace při běžném odeslání SÁM zapamatuje, a že se z něj pak odešle
   * zpráva uživateli, který do žádného projektu nepatří.
   */
  it('obnova hesla dorazí i uživateli bez projektu, přes projekt instalace', async () => {
    if (!available) return;
    resetSystemMailerInstallation();
    installSystemMailer();

    // Klíč se čistí schválně: sourozenecké testy v tomhle souboru sdílejí jednu
    // databázi a mohly ho vyplnit svým projektem.
    await withoutContext((tx) =>
      tx.execute(
        rawSql(`UPDATE system_settings SET settings = settings #- '{systemMail,workspace_id}'`, []),
      ),
    );

    const ctx = await withTestWorkspace();
    await seedSmtpAccount(ctx as never);

    // Obyčejné odeslání s projektem: tady se má klíč sám vyplnit.
    const first = `pamet-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'invitation',
      to: first,
      locale: 'cs',
      data: { url: 'https://mlain.test/invitations/accept?token=pamet' },
      workspaceId: ctx.workspaceId,
    });
    await waitForMessage(first);
    expect(await withoutContext(readInstallationSystemMailWorkspace)).toBe(ctx.workspaceId);

    // Uživatel BEZ jediného členství. Přesně ten stav zná stránka `no-workspace`.
    const loneUserId = await withoutContext(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        rawSql(
          `INSERT INTO users (email, password_hash, name, locale, timezone)
           VALUES ($1, 'x', 'Bez projektu', 'cs', 'Europe/Prague') RETURNING id`,
          [`bez-projektu-${Date.now()}@example.test`],
        ),
      );
      return r.rows[0]!.id;
    });

    const to = `reset-bez-projektu-${Date.now()}@example.test`;
    await queueSystemMail({
      template: 'password_reset',
      to,
      locale: 'cs',
      data: { url: 'https://mlain.test/reset-password?token=bez-projektu' },
      userId: loneUserId,
    });

    const message = await waitForMessage(to);
    expect(message.subject).toBe('Obnova hesla');
    expect(message.text).toContain('https://mlain.test/reset-password?token=bez-projektu');
  }, 60_000);

  /**
   * Zapamatovaný projekt se NEPŘEPISUJE. Až obrazovka Nastavení → Systémová pošta
   * dostane volbu projektu (bod 10 plánu), bude psát do téhož klíče a tenhle
   * mechanismus jí nesmí sahat pod ruku.
   */
  it('projekt instalace se zapamatuje jednou a dál se nepřepisuje', async () => {
    const first = randomUUID();
    const second = randomUUID();

    await withoutContext(async (tx) => {
      await tx.execute(
        rawSql(`UPDATE system_settings SET settings = settings #- '{systemMail,workspace_id}'`, []),
      );
      expect(await rememberInstallationSystemMailWorkspace(tx, first)).toBe(true);
      expect(await rememberInstallationSystemMailWorkspace(tx, second)).toBe(false);
      expect(await readInstallationSystemMailWorkspace(tx)).toBe(first);
    });
  }, 60_000);
});
