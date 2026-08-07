import pino, { type Logger } from 'pino';
import { loadConfig, type MlainConfig } from '../config';
import { decryptProviderConfig } from '../providers/crypto';
import { sendSmtp } from '../providers/smtp/send';
import { createSystemContext } from '../identity/context';
import { withoutContext, withUser, withWorkspace } from '../tx';
import { rawSql } from '../campaigns/repo/raw-sql';
import { buildSystemMailMime, renderSystemMail } from './system-mail-templates';
import {
  readSystemMailSettings,
  resolveSystemMailAccount,
  resolveSystemMailFrom,
  type SystemMailAccount,
  type SystemMailSettings,
} from './system-mail-config';
import {
  readInstallationSystemMailWorkspace,
  rememberInstallationSystemMailWorkspace,
} from './system-mail-installation';
import { sendSystemMailSes } from './system-mail-ses';
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

/**
 * Odeslání selhalo na straně poskytovatele. Taky se hází, ze stejného důvodu.
 *
 * `providerCode` je kód od SMTP serveru, nebo jméno výjimky AWS (`MessageRejected`
 * u neověřené adresy odesílatele, `TooManyRequestsException` u throttlingu).
 * Zůstává v textu, protože každý z těch stavů se opravuje jinak.
 */
export class SystemMailSendError extends Error {
  readonly code = 'system_mail_send_failed';
  constructor(providerCode: string, detail: string) {
    super(`Systémový e-mail se nepodařilo odeslat (${providerCode}): ${detail}`);
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
 *
 * TŘETÍ MOŽNOST je projekt systémové pošty instalace (rozhodnutí R2 plánu).
 * Uživatel odebraný z posledního projektu žádný nemá, a přesto se musí dostat
 * k obnově hesla; stránka `no-workspace` takový stav zná, takže není hypotetický.
 * Podrobnosti a proč se projekt instalace nedá NAJÍT dotazem, ale musí se
 * pamatovat, jsou v `system-mail-installation.ts`.
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

    const installation = await withoutContext(readInstallationSystemMailWorkspace);
    if (installation) return installation;

    throw new SystemMailNotConfiguredError(
      'uživatel nepatří do žádného projektu a instalace nemá zapamatovaný projekt ' +
        'systémové pošty, není tedy odkud vzít odesílací účet.',
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
    /**
     * Projekt, který systémovou poštu odeslat UMÍ, se zapamatuje jako projekt
     * instalace, pokud tam ještě žádný není. Je to jediné místo, kde se ta
     * informace dá získat spolehlivě: tady je kontext projektu, takže izolace
     * `sending_providers` nepřekáží. Zápis se dělá ve stejné transakci, aby
     * nevzniklo druhé spojení kvůli jednomu UPDATE; `system_settings` je bez RLS
     * a aplikační role smí měnit sloupec `settings`, takže kontext projektu
     * ničemu nevadí.
     */
    if (resolved.account !== null && resolved.reason === null) {
      await rememberInstallationSystemMailWorkspace(tx, workspaceId);
    }
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
   * Neznámý typ účtu se hlásí nahlas jako nenastavená pošta, ne jako úspěch.
   * Dnes to nemá jak nastat: `SYSTEM_MAIL_CAPABLE_TYPES` obsahuje oba typy,
   * které schéma odesílacího účtu zná. Zůstává to tu jako pojistka pro chvíli,
   * kdy přibude třetí typ a někdo zapomene na větev v `send`.
   */
  if (resolved.reason === 'provider_unsupported') {
    throw new SystemMailNotConfiguredError(
      `odesílací účet typu ${resolved.account.type} systémovou poštu odeslat neumí. ` +
        'Vyber v Nastavení → Systémová pošta jiný účet.',
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
    if (config.kind !== account.type) {
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

    /**
     * Obě větve dostávají TOTÉŽ MIME a liší se jen dopravou. Kdyby si každá
     * skládala zprávu po svém, rozešly by se hlavičky `Auto-Submitted`
     * a `X-Auto-Response-Suppress`, a to zrovna u větve, kterou nikdo ručně
     * nekontroluje v poštovní pasti.
     */
    const result =
      config.kind === 'ses'
        ? await sendSystemMailSes({
            config,
            from,
            to: mail.to,
            message,
            timeoutMs: cfg().AWS_API_TIMEOUT_MS,
          })
        : await sendSmtp({
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
      { template: mail.template, to: mail.to, provider_id: account.id, provider: config.kind },
      'system_mail_sent',
    );
  }
}
