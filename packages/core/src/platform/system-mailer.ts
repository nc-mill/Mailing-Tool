import pino, { type Logger } from 'pino';
import { loadConfig, type MlainConfig } from '../config';
import { decryptProviderConfig } from '../providers/crypto';
import { sendSmtp } from '../providers/smtp/send';
import { createSystemContext } from '../identity/context';
import { withUser, withWorkspace } from '../tx';
import { rawSql } from '../campaigns/repo/raw-sql';
import { buildSystemMailMime, renderSystemMail } from './system-mail-templates';
import type { SystemMail, SystemMailer } from './system-mail';

/**
 * Skutečný odesílatel systémových e-mailů.
 *
 * PROČ TENHLE SOUBOR VZNIKL. `setSystemMailer` existovala od P04 a NIKDO ji
 * nevolal, takže `queueSystemMail` jen zalogovala `system_mail_not_configured`
 * a vrátila úspěch. Následek nebyl kosmetický: kdo zapomněl heslo, dostal na
 * obrazovce „e-mail odeslán" a nepřišlo nic, a protože se v produkci nelogoval
 * ani odkaz, do instalace se už nedostal. Totéž u pozvánek: nový člověk se do
 * projektu nedostal vůbec.
 *
 * Je to týž tvar vady jako nálezy I71 a I72: kód existoval, měl zelené testy,
 * nikdo ho nezapojil, a selhání bylo tiché.
 */

let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

let cachedLogger: Logger | null = null;
function logger(): Logger {
  cachedLogger ??= pino({ level: cfg().LOG_LEVEL });
  return cachedLogger;
}

/**
 * Instalace nemá ani jeden odesílací účet, kterým by šlo systémovou poštu poslat.
 *
 * HÁZÍ SE, NEZAHAZUJE SE, a je to rozhodnutí, ne nedbalost. Tichý zápis do logu
 * je přesně to, co tuhle vadu drželo naživu: obrazovka hlásila úspěch, do logu
 * šel `warn`, a nikdo neměl důvod hledat. Volající se s výjimkou vypořádá po svém,
 * ale nikdo nesmí uživateli tvrdit, že zpráva odešla, když neodešla.
 */
export class SystemMailNotConfiguredError extends Error {
  readonly code = 'system_mail_not_configured';
  constructor(detail: string) {
    super(`Systémový e-mail nelze odeslat: ${detail}`);
    this.name = 'SystemMailNotConfiguredError';
  }
}

/** Odeslání selhalo na straně SMTP serveru. Taky se hází, ze stejného důvodu. */
export class SystemMailSendError extends Error {
  readonly code = 'system_mail_send_failed';
  constructor(smtpCode: string, detail: string) {
    super(`Systémový e-mail se nepodařilo odeslat (${smtpCode}): ${detail}`);
    this.name = 'SystemMailSendError';
  }
}

type AccountRow = {
  id: string;
  workspace_id: string;
  type: string;
  config_encrypted: string;
  domain: string | null;
};

/**
 * Který projekt zprávu odešle.
 *
 * `withoutContext` se tu POUŽÍT NEDÁ, i když by to na první pohled dávalo smysl:
 * `sending_providers` má politiku `ws_isolation` a bez kontextu projektu vrací
 * dotaz nula řádků. Ověřeno spuštěním, první podoba tohohle souboru na to spadla
 * a chybová hláška zněla „instalace nemá ani jeden odesílací účet" u projektu,
 * který účet měl.
 *
 * Zpráva má proto BUĎ projekt (pozvánka, ověření adresy, vypnutý webhook), NEBO
 * uživatele (obnova hesla, upozornění na změnu hesla). Uživatel projekt nemá:
 * kdo zapomene heslo, není přihlášený. Jeho projekty se dohledají cestou
 * `withUser`, kterou politika `ws_member_visibility` k tomu účelu vystavuje,
 * a bere se ten nejstarší, tedy ten, který si po instalaci založil první.
 */
async function resolveWorkspaceId(mail: SystemMail): Promise<string> {
  if (mail.workspaceId) return mail.workspaceId;

  if (mail.userId) {
    const rows = await withUser(mail.userId, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        rawSql(
          `SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
          [],
        ),
      );
      return r.rows;
    });
    const id = rows[0]?.id;
    if (id) return id;
    throw new SystemMailNotConfiguredError(
      'uživatel nepatří do žádného projektu, není tedy odkud vzít odesílací účet.',
    );
  }

  throw new SystemMailNotConfiguredError(
    'zpráva nenese ani projekt, ani uživatele, takže nejde vybrat odesílací účet.',
  );
}

/**
 * Výběr odesílacího účtu projektu.
 *
 * ÚČTY TYPU SMTP MAJÍ PŘEDNOST PŘED VÝCHOZÍM ÚČTEM, a není to libovůle. Systémovou
 * poštu odsud umí odeslat jen SMTP (klient SES je v senderu v Go), takže projekt,
 * který má jako výchozí SES a vedle toho SMTP účet, musí použít ten SMTP. Řazení
 * podle `is_default` jako první by v takovém projektu vrátilo SES a systémová pošta
 * by neodešla, přestože instalace má čím. Uvnitř téhož typu rozhoduje `is_default`,
 * pak stáří.
 *
 * `status` se filtruje na účty, které nejsou zablokované ani vypnuté. Neověřený
 * účet PROJDE: hned po instalaci je každý účet `unverified` a právě tehdy chodí
 * pozvánky, kvůli kterým to celé je.
 */
async function pickAccount(workspaceId: string): Promise<AccountRow> {
  const SQL = `
    SELECT p.id, p.workspace_id, p.type, p.config_encrypted,
           (SELECT d.domain FROM sender_domains d
             WHERE d.provider_id = p.id AND d.verified_at IS NOT NULL
             ORDER BY d.created_at LIMIT 1) AS domain
      FROM sending_providers p
     WHERE p.workspace_id = $1
       AND p.status NOT IN ('blocked', 'disabled')
     ORDER BY (p.type = 'smtp') DESC, p.is_default DESC, p.created_at
     LIMIT 1`;

  const ctx = createSystemContext(workspaceId, 'platform.system_mail');
  const rows = await withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<AccountRow>(rawSql(SQL, [workspaceId]));
    return r.rows;
  });

  const account = rows[0];
  if (!account) {
    throw new SystemMailNotConfiguredError(
      'projekt nemá odesílací účet. Založ ho v Nastavení → Odesílání.',
    );
  }
  return account;
}

/**
 * Adresa odesílatele.
 *
 * Bere se ověřená doména účtu, protože jen z ní zpráva projde SPF a DKIM. Když
 * účet ověřenou doménu nemá (stav hned po instalaci), použije se host z `APP_URL`.
 * Je to horší adresa, ale doručitelná zpráva se špatnou adresou je pořád lepší než
 * žádná, a přesně v tomhle stavu chodí pozvánky.
 */
function fromAddress(account: AccountRow): string {
  const host = account.domain ?? new URL(cfg().APP_URL).hostname;
  return `mlain@${host}`;
}

export class DefaultSystemMailer implements SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    const account = await pickAccount(await resolveWorkspaceId(mail));

    /**
     * SES se odsud NEODESÍLÁ. Klient SES je v senderu v Go a v TypeScriptu žádný
     * není; přidávat sem druhý by znamenalo mít podpis AWS na dvou místech.
     * Hlásí se to nahlas jako nenastavená pošta, ne jako úspěch: instalace, která
     * má jediný účet typu SES, systémovou poštu prostě zatím poslat neumí.
     */
    if (account.type !== 'smtp') {
      throw new SystemMailNotConfiguredError(
        `odesílací účet typu ${account.type} systémovou poštu neumí. Přidej účet typu SMTP.`,
      );
    }

    const config = decryptProviderConfig({
      stored: account.config_encrypted,
      workspaceId: account.workspace_id,
    });
    if (config.kind !== 'smtp') {
      throw new SystemMailNotConfiguredError(
        'typ účtu v databázi a v šifrované obálce se rozchází.',
      );
    }

    const rendered = renderSystemMail(mail);
    const from = fromAddress(account);
    const message = buildSystemMailMime({
      from,
      to: mail.to,
      rendered,
      now: new Date(),
      messageIdHost: new URL(cfg().APP_URL).hostname,
    });

    const result = await sendSmtp({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      encryption: config.encryption,
      timeoutMs: cfg().SENDER_SMTP_COMMAND_TIMEOUT_SECONDS * 1000,
      // Poštovní past v E2E i vývojová instalace běží na neveřejné adrese. Ochrana
      // proti SSRF tady nechrání před ničím: host nezadává útočník přes formulář
      // veřejného webu, ale vlastník instalace v nastavení odesílacího účtu, a ten
      // už si stejně smí nastavit cokoliv.
      allowPrivateAddress: true,
      from,
      to: mail.to,
      message,
    });

    if (!result.ok) {
      throw new SystemMailSendError(result.code, result.detail);
    }

    logger().info(
      { template: mail.template, to: mail.to, provider_id: account.id },
      'system_mail_sent',
    );
  }
}
