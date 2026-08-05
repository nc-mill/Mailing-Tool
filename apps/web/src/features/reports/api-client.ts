export class ReportsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly detail: string | null,
  ) {
    super(detail ?? code);
    this.name = 'ReportsApiError';
  }
}

export type FetchResult<T> =
  { status: 'ok'; data: T; etag: string | null } | { status: 'not_modified' };

export type FetchOptions = {
  etag?: string | null;
  /**
   * Posílá se jako hlavička `X-Workspace-Id`. Autentizace API pro aktéra typu
   * `user` skládá projekt buď z téhle hlavičky, nebo ze segmentu `/w/{slug}`
   * v CESTĚ POŽADAVKU. `/api/v1/**` ale žádný takový segment nemá (to je
   * jen cesta prohlížeče), takže bez hlavičky middleware nenajde projekt
   * a vrátí `not_found`, tedy 404. Bez ní se přehled i trend kampaní
   * nenačtou vůbec, ne jen jednotlivé dlaždice.
   */
  workspaceId?: string;
  /**
   * Jazyk pro věty skládané na serveru. Když chybí, bere se z `<html lang>`,
   * tedy z jazyka aplikace. Nikdy se nespoléhá na to, co pošle prohlížeč sám.
   */
  locale?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * Projekt odvozený z adresy, na které se uživatel právě nachází.
 *
 * Tenhle klient běží VÝHRADNĚ v prohlížeči, kde `location.pathname` je cesta
 * obrazovky, tedy `/w/{slug}/…` nebo `/cs/w/{slug}/…`. Slug je tam vždycky,
 * takže se nemusí protahovat přes každou komponentu zvlášť.
 *
 * Je to oprava celé třídy vad, ne jednoho místa. Hlavičku `X-Workspace-Id`
 * nepředávalo šest volání napříč reporty: přehled, trend kampaní, report
 * kampaně, panel příjemců, časová osa kontaktu a živé statistiky. Každé z nich
 * dostalo 404 a obrazovka místo dat ukázala chybu. Opravovat to protažením
 * parametru přes komponenty znamená čekat, až na to někdo u sedmého volání
 * zapomene.
 *
 * Výslovně předaný `workspaceId` má přednost, takže testy i zvláštní případy
 * můžou poslat něco jiného.
 */
function workspaceFromLocation(): string | null {
  if (typeof location === 'undefined') return null;
  return /(?:^|\/)w\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;
}

/**
 * Jazyk APLIKACE, ne prohlížeče. Posílá se jako `Accept-Language`.
 *
 * OPRAVA CELÉ TŘÍDY VAD, NE JEDNOHO TEXTU. Věty časové osy skládá server
 * (`contacts/{id}/timeline`), aby je nemusel implementovat každý klient API,
 * a jazyk si vyjednává z `Accept-Language`. Prohlížeč tam ale posílá SVOJE
 * nastavení, na běžném Chromu `en-US,en;q=0.9`. Aplikace běžela česky,
 * `<html lang="cs">`, a osa přesto psala „Received campaign", „Opened campaign"
 * a „Granted consent". Katalogu nechybělo nic, české překlady tam byly celou
 * dobu, jen se nikdy nepoužily. Naměřeno v prohlížeči: tentýž požadavek
 * s `Accept-Language: cs` vrátil „Dostal kampaň", bez hlavičky angličtinu.
 *
 * Zdrojem je `<html lang>`, které nastavuje next-intl podle jazyka projektu.
 * Vyjednávání na serveru zůstává, jak je: pro cizí klienty API je
 * `Accept-Language` správná cesta. Chybělo jen to, že náš vlastní klient
 * o jazyku aplikace mlčel a nechal za sebe mluvit prohlížeč.
 */
function localeFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  const lang = document.documentElement.lang.trim();
  return lang === '' ? null : lang;
}

/**
 * Tenký klient nad veřejným API. Obrazovky reportů nemluví s databází přímo,
 * takže závisí jen na kontraktu, který vlastní P04, ne na jeho vnitřcích.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.etag) headers['If-None-Match'] = options.etag;

  const workspace = options.workspaceId ?? workspaceFromLocation();
  if (workspace) headers['X-Workspace-Id'] = workspace;

  const locale = options.locale ?? localeFromDocument();
  if (locale) headers['Accept-Language'] = locale;

  const response = await doFetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 304) return { status: 'not_modified' };

  if (!response.ok) {
    let code = 'unknown_error';
    let requestId: string | null = null;
    let detail: string | null = null;
    try {
      const problem = (await response.json()) as Record<string, unknown>;
      code = typeof problem.code === 'string' ? problem.code : code;
      requestId = typeof problem.request_id === 'string' ? problem.request_id : null;
      detail = typeof problem.detail === 'string' ? problem.detail : null;
    } catch {
      // Tělo nemuselo být JSON. Kód chyby zůstane obecný, stránka se nerozbije.
    }
    throw new ReportsApiError(response.status, code, requestId, detail);
  }

  return { status: 'ok', data: (await response.json()) as T, etag: response.headers.get('ETag') };
}

export function campaignStatsUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/stats`;
}

export function campaignProgressUrl(campaignId: string, granularity: string): string {
  return `/api/v1/campaigns/${campaignId}/stats/timeline?granularity=${granularity}`;
}

export function campaignLinksUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/links`;
}

/**
 * Kliknutí na odkazy v patičce: odhlášení, předvolby, webová verze.
 * Vlastní adresa, ne pole v `/stats`, protože se ta čísla mění nezávisle
 * na verzi souhrnu, ze které se skládá ETag.
 */
export function campaignSystemLinkClicksUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/system-link-clicks`;
}

/**
 * Odeslaná podoba kampaně, VYRENDEROVANÁ. Vrací `compiled_html` interpolované
 * daty skutečné odeslané zprávy, takže náhled ukazuje to, co příjemce dostal
 * do schránky, ne zdrojovou podobu se syrovými Liquid výrazy a ne to, co by
 * z dnešní šablony vzniklo.
 *
 * Nezaměňovat se dvěma sousedy: `/campaigns/{id}/preview` z domény kampaní
 * vrací uložené sloupce tak, jak jsou, a `/campaigns/{id}/audience/preview`
 * je odhad publika.
 */
export function campaignSentContentUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/sent-content`;
}

export function recipientsUrl(campaignId: string, filter: string, cursor?: string): string {
  const query = new URLSearchParams({ filter, limit: '50' });
  if (cursor) query.set('cursor', cursor);
  return `/api/v1/campaigns/${campaignId}/recipients?${query.toString()}`;
}

export function timelineUrl(
  contactId: string,
  params: { types?: string; cursor?: string },
): string {
  const query = new URLSearchParams({ limit: '50' });
  if (params.types) query.set('types', params.types);
  if (params.cursor) query.set('cursor', params.cursor);
  return `/api/v1/contacts/${contactId}/timeline?${query.toString()}`;
}

export function dashboardUrl(period: number): string {
  return `/api/v1/dashboard?period=${period}`;
}

/**
 * Co příjemci kampaně dělali na webu.
 *
 * Vlastní adresa, ne pole v `/stats`. Souhrn kampaně se počítá z `campaign_stats`
 * a jeho verze se mění po každé události v e-mailu; webová aktivita se počítá
 * z `web_events` a mění se úplně jinak. Sloučené do jedné odpovědi by ETag
 * jedné z nich lhal.
 */
export function campaignWebActivityUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/web-activity`;
}

export function webActivityUrl(periodDays: number): string {
  return `/api/v1/web-activity?period=${periodDays}`;
}
