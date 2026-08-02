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
