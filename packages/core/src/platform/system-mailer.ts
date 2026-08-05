import pino, { type Logger } from 'pino';
import { loadConfig, type MlainConfig } from '../config';
import { decryptProviderConfig } from '../providers/crypto';
import { sendSmtp } from '../providers/smtp/send';
import { createSystemContext } from '../identity/context';
import { withUser, withWorkspace } from '../tx';
import { rawSql } from '../campaigns/repo/raw-sql';
import { buildSystemMailMime, renderSystemMail } from './system-mail-templates';
import {
  readSystemMailSettings,
  resolveSystemMailAccount,
  resolveSystemMailFrom,
  type SystemMailAccount,
  type SystemMailSettings,
} from './system-mail-config';
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
 * Výběr odesílacího účtu a adresy odesílatele.
 *
 * ROZHODOVÁNÍ TU UŽ NENÍ. Přesunulo se do `system-mail-config.ts`, protože týž
 * výběr musí umět i obrazovka Nastavení → Systémová pošta: ta uživateli dopředu
 * říká, jestli pošta odejde, kterým účtem a z jaké adresy. Dva nezávisle napsané
 * výběry by se rozešly a obrazovka by slibovala něco jiného, než odesílatel udělá.
 *
 * Zůstává tu jen převod výsledku na výjimku, kterou volající umí zpracovat.
 */
async function pickAccount(workspaceId: string): Promise<{
  account: SystemMailAccount;
  settings: SystemMailSettings;
}> {
  const ctx = createSystemContext(workspaceId, 'platform.system_mail');
  const { settings, resolved } = await withWorkspace(ctx, async (tx) => {
    const settings = await readSystemMailSettings(tx, workspaceId);
    const resolved = await resolveSystemMailAccount(tx, workspaceId, settings);
    return { settings, resolved };
  });

  if (!resolved.account) {
    throw new SystemMailNotConfiguredError(
      resolved.reason === 'selected_account_missing'
        ? 'účet vybraný pro systémovou poštu v projektu není, nebo je vypnutý. Vyber jiný v Nastavení → Systémová pošta.'
        : 'projekt nemá odesílací účet. Založ ho v Nastavení → Odesílání.',
    );
  }

  /**
   * SES se odsud NEODESÍLÁ. Klient SES je v senderu v Go a v TypeScriptu žádný
   * není; přidávat sem druhý by znamenalo mít podpis AWS na dvou místech.
   * Hlásí se to nahlas jako nenastavená pošta, ne jako úspěch: instalace, která
   * má jediný účet typu SES, systémovou poštu prostě zatím poslat neumí.
   */
  if (resolved.reason === 'provider_unsupported') {
    throw new SystemMailNotConfiguredError(
      `odesílací účet typu ${resolved.account.type} systémovou poštu neumí. Přidej účet typu SMTP.`,
    );
  }

  return { account: resolved.account, settings };
}

export class DefaultSystemMailer implements SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    const { account, settings } = await pickAccount(await resolveWorkspaceId(mail));

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
    const from = resolveSystemMailFrom(account, settings, cfg().APP_URL).address;
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
