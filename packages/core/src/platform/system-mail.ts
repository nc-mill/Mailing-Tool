import pino, { type Logger } from 'pino';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';

/**
 * Rozhodnutí R7 plánu P04. Systémové e-maily potřebují blokové šablony (P08)
 * a odesílací pipeline (P13). Tenhle plán definuje jen port, aby na něm mohly
 * stát reset hesla, pozvánky a upozornění na deaktivovaný webhook.
 */
export type SystemMailName =
  | 'password_reset'
  | 'password_changed'
  | 'invitation'
  | 'webhook_endpoint_disabled'
  /* Potvrzení adresy ve zkušebním režimu (část 6, 8.2.8). Jde na adresu, která
     v nástroji nemá účet, takže je to systémový e-mail, ne zpráva z kampaně. */
  | 'trial_address_verification';

export type SystemMail = {
  template: SystemMailName;
  to: string;
  locale: string;
  data: Record<string, string>;
  /**
   * Projekt, ze kterého zpráva vznikla. Slouží k výběru odesílacího účtu, NE
   * k autorizaci: odesílatel podle něj vybere výchozí účet toho projektu.
   *
   * Je nepovinný, protože dvě z pěti zpráv projekt opravdu nemají. Obnovu hesla
   * si vyžádá člověk, který není přihlášený; ty zprávy místo projektu nesou `userId`.
   */
  workspaceId?: string;
  /**
   * Uživatel, kterého se zpráva týká. Používá se JEN tehdy, když `workspaceId`
   * chybí: odesílatel z něj dohledá nejstarší projekt uživatele a vezme jeho
   * odesílací účet.
   *
   * Bez jednoho z těch dvou polí se zpráva NEODEŠLE a hlásí se to nahlas. Není
   * to formalita: `sending_providers` má izolaci po projektech, takže bez kontextu
   * projektu vrátí dotaz na odesílací účet nula řádků, ať je účtů v instalaci
   * kolik chce.
   */
  userId?: string;
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
 * Nouzová implementace, která zprávu jen zaloguje.
 *
 * UŽ NENÍ VÝCHOZÍM CHOVÁNÍM PROCESU a je to celý smysl téhle změny. Byla jím
 * a stálo to obnovu hesla: `setSystemMailer` nikdo nevolal, takže tahle třída
 * tiše spolkla každou zprávu a ohlásila úspěch. Zůstává pro testy a pro proces,
 * který si ji vědomě dosadí přes `setSystemMailer`.
 *
 * V produkci se loguje `error`, ne `warn`. Zahozený e-mail o hesle je porucha,
 * a porucha, která se hlásí jako varování, se nedostane do žádného upozornění.
 */
export class LoggingSystemMailer implements SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    if (cfg().NODE_ENV === 'production') {
      logger().error(
        { template: mail.template, to: mail.to, locale: mail.locale },
        'system_mail_not_configured',
      );
      return;
    }
    logger().warn({ ...mail }, 'system_mail_not_configured');
  }
}

/**
 * `null` znamená „nikdo nic nedosadil", NE „posílej do logu".
 *
 * Výchozí hodnotou byla instance `LoggingSystemMailer` a byla to past. Modulová
 * proměnná se spoléhá na to, že ji někdo jiný přepsal, a v Next.js to neplatí:
 * `instrumentation.ts` a obsluhy tras můžou skončit v ODDĚLENÝCH modulových
 * grafech, takže každý dostane vlastní kopii tohohle modulu a vlastní `mailer`.
 * Instrumentation nastaví svoji, trasa čte svoji, a ta je pořád ta logující.
 * Ve workeru se to neprojeví, protože je to jeden proces s jedním grafem, což
 * přesně odpovídá pozorování, že padal jen web.
 *
 * Odesílatel se proto sestaví LÍNĚ při prvním použití. Nikdo ho nemusí zapojit,
 * takže se na nikom nedá zapomenout, a `setSystemMailer` zůstává jen jako
 * možnost ho přepsat.
 */
let mailer: SystemMailer | null = null;
let building: Promise<SystemMailer> | null = null;

/**
 * Dosadí vlastního odesílatele. Přebije líné sestavení.
 *
 * `null` vrátí modul do stavu „nikdo nic nedosadil", takže se při příštím
 * odeslání sestaví výchozí. Je to pro testy líné cesty, ne pro produkci.
 */
export function setSystemMailer(next: SystemMailer | null): void {
  mailer = next;
  building = null;
}

/** Vrací, co je právě dosazené, nebo `null`. Existuje kvůli testům zapojení. */
export function currentSystemMailer(): SystemMailer | null {
  return mailer;
}

/**
 * Které zprávy smí selhat potichu a které ne.
 *
 * Rozdíl je v tom, co uživatel ztratí. Bez `password_reset` se do instalace
 * nedostane NIKDY, bez `invitation` se do projektu nedostane nový člověk a bez
 * `trial_address_verification` nejde dokončit zkušební režim. U těch se výjimka
 * hází dál, aby obrazovka nemohla tvrdit „e-mail odeslán", když neodešel.
 *
 * Zbylé dvě jsou informační o něčem, co UŽ SE STALO: heslo je změněné a webhook
 * je vypnutý, ať e-mail dorazí, nebo ne. Shodit kvůli nim operaci, která proběhla,
 * by bylo horší než ta nedoručená zpráva; selhání se zaloguje a jde se dál.
 */
const MUST_NOT_FAIL_SILENTLY: ReadonlySet<SystemMailName> = new Set([
  'password_reset',
  'invitation',
  'trial_address_verification',
]);

/**
 * Dynamický import je nutný, ne kosmetický. Statický by z tohohle modulu udělal
 * bránu do databáze, šifrování a SMTP, a `system-mail.ts` se dotýká i kód, který
 * nic z toho nepotřebuje.
 */
async function resolveMailer(): Promise<SystemMailer> {
  if (mailer) return mailer;
  building ??= import('./system-mailer').then((m) => {
    const built = new m.DefaultSystemMailer();
    mailer ??= built;
    return mailer;
  });
  return building;
}

/**
 * Selhání se loguje S DŮVODEM a pak se hází dál.
 *
 * Dřív se logovaly jen `template`, `to` a `locale`, takže se ze čtyř možných
 * příčin nepoznala ani jedna. Do záznamu jde `err` i `code` z výjimky a jméno
 * třídy odesílatele, aby šlo z jedné řádky poznat, jestli je zapojený ten pravý.
 *
 * MIMO PRODUKCI má nenastavená pošta ještě náhradní cestu: odkaz se dopíše do logu,
 * jak to dělal `LoggingSystemMailer`. Není to návrat k té pasti. Past byla v tom,
 * že logování bylo VÝCHOZÍ stav a hlásilo úspěch; tohle je pojmenovaná záchranná
 * větev pro jedinou příčinu (`system_mail_not_configured`), do logu jde `error`
 * s důvodem a v produkci se neuplatní vůbec. Bez ní by čerstvá vývojová instalace
 * bez odesílacího účtu vracela na obnovu hesla chybu 500, tedy horší stav, než
 * jaký R7 plánu P04 tou třídou řešil.
 */
export async function queueSystemMail(mail: SystemMail): Promise<void> {
  const active = await resolveMailer();
  try {
    await active.send(mail);
  } catch (error) {
    const e = error as { message?: string; code?: string };
    logger().error(
      {
        template: mail.template,
        to: mail.to,
        locale: mail.locale,
        mailer: active.constructor.name,
        code: e.code ?? 'unknown',
        err: e.message ?? String(error),
      },
      'system_mail_failed',
    );

    const notConfigured = e.code === 'system_mail_not_configured';

    /**
     * Mimo produkci se odkaz NAVÍC dopíše do logu, ale operace se tím
     * NEPROHLÁSÍ ZA ÚSPĚŠNOU.
     *
     * Dřív se tady rovnou vracelo, takže vývojová instalace bez odesílacího
     * účtu hlásila „e-mail odeslán". To je přesně ta tichá lež, kvůli které
     * celá tahle větev existuje, jen posunutá o patro níž: uživatel vývojové
     * instalace čeká na e-mail zrovna tak jako uživatel produkční a do logu
     * se nedívá. Zápis do logu zůstává jako pomůcka pro vývojáře, výjimka se
     * u zpráv, které selhat potichu nesmí, hází dál.
     */
    if (notConfigured && cfg().NODE_ENV !== 'production') {
      await new LoggingSystemMailer().send(mail);
    }
    if (MUST_NOT_FAIL_SILENTLY.has(mail.template)) {
      /**
       * Ven jde POJMENOVANÁ chyba API, ne vnitřní výjimka odesílatele.
       *
       * Vnitřní výjimka končila v obsluze jako neznámý pád, tedy jako pětistovka
       * s hláškou „něco se pokazilo". Uživatel z toho nemá jak poznat, že mu jen
       * chybí nastavení, a hledá chybu tam, kde žádná není. Kód
       * `system_mail_unavailable` má v katalogu vlastní text i návod, takže se
       * na obrazovce ukáže věcný důvod a cesta k nápravě.
       *
       * Původní výjimka zůstává jako `cause`, aby se ze záznamu nedala ztratit
       * příčina (chybějící účet versus odmítnutí SMTP serverem).
       */
      if (notConfigured) throw new ApiError('system_mail_unavailable', { cause: error });
      throw error;
    }
  }
}
