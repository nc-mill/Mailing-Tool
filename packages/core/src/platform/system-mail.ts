import pino, { type Logger } from 'pino';
import { loadConfig, type MlainConfig } from '../config';

/**
 * Rozhodnutí R7 plánu P04. Systémové e-maily potřebují blokové šablony (P08)
 * a odesílací pipeline (P13). Tenhle plán definuje jen port, aby na něm mohly
 * stát reset hesla, pozvánky a upozornění na deaktivovaný webhook.
 */
export type SystemMailName =
  'password_reset' | 'password_changed' | 'invitation' | 'webhook_endpoint_disabled';

export type SystemMail = {
  template: SystemMailName;
  to: string;
  locale: string;
  data: Record<string, string>;
};

export interface SystemMailer {
  send(mail: SystemMail): Promise<void>;
}

/**
 * ODCHYLKA OD PLÁNU: plán četl konfiguraci i vyráběl logger na úrovni modulu.
 * P01 vydává jen `loadConfig()`, který bez kompletního prostředí hází, takže by
 * import tohohle souboru shodil každý test, který se ho jen dotkne. Obojí je
 * proto líné a memoizované, stejně jako v `session.ts` a `tx/index.ts`.
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
 * Výchozí implementace. Mimo produkci zaloguje i odkaz, aby šla instalace rozjet
 * a aby P06 mohl vyvíjet obrazovky bez odesílací pipeline. V produkci zaloguje
 * jen typ zprávy a příjemce, protože odkaz v logu je použitelný přihlašovací
 * artefakt a log čte víc lidí než schránku.
 */
export class LoggingSystemMailer implements SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    if (cfg().NODE_ENV === 'production') {
      logger().warn(
        { template: mail.template, to: mail.to, locale: mail.locale },
        'system_mail_not_configured',
      );
      return;
    }
    logger().warn({ ...mail }, 'system_mail_not_configured');
  }
}

let mailer: SystemMailer = new LoggingSystemMailer();

/** Skutečnou implementaci zapojí P13 při startu procesu. */
export function setSystemMailer(next: SystemMailer): void {
  mailer = next;
}

export function queueSystemMail(mail: SystemMail): Promise<void> {
  return mailer.send(mail);
}
