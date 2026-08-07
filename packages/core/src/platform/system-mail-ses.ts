import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { classifySesError } from '../providers/ses/classify-error';
import type { SesConfig } from '../providers/types';

/**
 * Odeslání systémové pošty účtem typu SES.
 *
 * PROČ TENHLE SOUBOR VZNIKL. `SYSTEM_MAIL_CAPABLE_TYPES` byl jednoprvkový seznam
 * `['smtp']` a komentář u něj tvrdil, že klient SES je jen v odesílači napsaném
 * v Go. To přestalo platit: `@aws-sdk/client-sesv2` je v `packages/core` kvůli
 * ověřování domén a konfiguračních sad, takže odeslání je JEDNO volání navíc,
 * ne druhá implementace podpisu AWS. Instalace po průvodci má typicky jediný
 * účet typu SES, takže do téhle chvíle neodešla pozvánka, obnova hesla ani
 * ověření adresy ve zkušebním režimu.
 *
 * Posílá se HOTOVÉ MIME (`Content.Raw`), totéž, co skládá `buildSystemMailMime`
 * a co posílá dispatcher v Go (`apps/sender/internal/provider/ses/ses.go`).
 * Vlastní skládání předmětu a částí přes `Content.Simple` by znamenalo druhou
 * podobu téže zprávy a hlavičky `Auto-Submitted` a `X-Auto-Response-Suppress`
 * by se do ní nedostaly vůbec.
 */

/** Úzké rozhraní klienta, aby šel v testu podstrčit falešný. */
export type SesSendApi = {
  send(command: SendEmailCommand): Promise<{ MessageId?: string | undefined }>;
};

export type SystemMailSesResult =
  { ok: true; messageId: string | null } | { ok: false; code: string; detail: string };

export type SystemMailSesInput = {
  config: SesConfig;
  from: string;
  to: string;
  /** Hotové MIME z `buildSystemMailMime`. */
  message: string;
  timeoutMs: number;
  /** Podstrčený klient pro testy. Bez něj se postaví skutečný. */
  api?: SesSendApi;
};

/**
 * Vstup pro `SendEmail`. Vystavuje se kvůli testu hlaviček a značek: co se do
 * příkazu NEDÁVÁ, je stejně důležité jako to, co se do něj dává.
 *
 * `EmailTags` se NENASTAVUJÍ, na rozdíl od kampaňového dispatcheru. Ten posílá
 * `ml_msg` a `ml_mday`, aby se odraz dal spárovat se zprávou v `messages`.
 * Systémová pošta ale žádný řádek v `messages` nemá a mít nebude (contact_id je
 * NOT NULL a příjemce není kontakt), takže by značky slibovaly párování, které
 * nemůže vyjít, a příjem událostí by dostal identifikátor ukazující do prázdna.
 * Je to zmírnění rizika RZ3 z plánu: bez značek je odraz systémové zprávy pro
 * příjem událostí prostě neznámá zpráva a zahodí se.
 *
 * `ListManagementOptions` se NENASTAVUJE ze stejného důvodu jako v Go: SES by
 * si do zprávy přidal vlastní odhlašovací hlavičky. Systémová pošta žádné mít
 * nesmí, viz test v `system-mail-headers.test.ts`.
 *
 * `ConfigurationSetName` jde do příkazu, jen když ho účet má. Prázdný řetězec
 * SES odmítne s `BadRequestException`, tedy chybou, která vypadá jako vada
 * zprávy, přestože jde o nevyplněné nastavení účtu.
 */
export function buildSystemMailSesCommand(input: {
  from: string;
  to: string;
  message: string;
  configurationSetName: string | null;
}): SendEmailCommand {
  const set = input.configurationSetName?.trim();
  return new SendEmailCommand({
    FromEmailAddress: input.from,
    Destination: { ToAddresses: [input.to] },
    Content: { Raw: { Data: Buffer.from(input.message, 'utf8') } },
    ...(set ? { ConfigurationSetName: set } : {}),
  });
}

/**
 * Vlastní klient, ne `createAwsClients`: ten staví i klienta SNS, který tady
 * není k ničemu, a `maxAttempts` nechává na výchozích třech. Systémová pošta
 * je synchronní, uživatel na ni čeká u formuláře, takže se drží jediný pokus
 * stejně jako v Go (`awsconfig.WithRetryMaxAttempts(1)`). Opakování patří
 * uživateli, ne skrytému čekání v obsluze požadavku.
 */
function buildClient(config: SesConfig, timeoutMs: number): SesSendApi {
  const client = new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.access_key_id,
      secretAccessKey: config.secret_access_key,
    },
    requestHandler: { requestTimeout: timeoutMs, connectionTimeout: timeoutMs },
    maxAttempts: 1,
  });
  return { send: (command) => client.send(command) };
}

function errorName(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'ses_send_failed';
  const record = err as Record<string, unknown>;
  const name = record['name'];
  if (typeof name === 'string' && name !== '' && name !== 'Error') return name;
  const code = record['Code'] ?? record['code'];
  return typeof code === 'string' && code !== '' ? code : 'ses_send_failed';
}

/**
 * Kód chyby se bere ze JMÉNA výjimky AWS, ne z textu: `MessageRejected`
 * (neověřená adresa odesílatele) a `TooManyRequestsException` (throttling,
 * riziko RZ1) se opravují každý jinak a v hlášce se to má poznat. Když jméno
 * nic neříká, doplní se zatřídění z `classifySesError`, tedy totéž, co vidí
 * uživatel u zkoušky připojení.
 */
export async function sendSystemMailSes(input: SystemMailSesInput): Promise<SystemMailSesResult> {
  const api = input.api ?? buildClient(input.config, input.timeoutMs);
  const command = buildSystemMailSesCommand({
    from: input.from,
    to: input.to,
    message: input.message,
    configurationSetName: input.config.configuration_set_name,
  });

  try {
    const out = await api.send(command);
    return { ok: true, messageId: out.MessageId ?? null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: errorName(err),
      detail: `${detail} (${classifySesError(err)})`,
    };
  }
}
