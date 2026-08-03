import { isIP } from 'node:net';
import { classifyAddress } from './address';
import { normalizeBrandUrl, type UrlPolicy } from './url';

export type ExtractionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked';

const ALLOWED_TRANSITIONS: Record<ExtractionStatus, readonly ExtractionStatus[]> = {
  pending: ['running', 'blocked'],
  running: ['succeeded', 'failed', 'blocked'],
  succeeded: [],
  failed: [],
  blocked: [],
};

/**
 * Koncový stav se nikdy nemění. Opakovaný pokus zakládá nový řádek, protože
 * obsah cizího webu se mezitím mohl změnit a „stejný vstup, stejný výstup"
 * tady neplatí.
 */
export function assertTransition(from: ExtractionStatus, to: ExtractionStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Nepovolený přechod extrakce: ${from} -> ${to}`);
  }
}

export type ExtractionHop = { url: string; status: number; ipClass: 'public' };

export type ServiceExtractionRow = {
  id: string;
  status: ExtractionStatus;
  inputUrl: string;
  normalizedUrl: string;
  errorCode: string | null;
  hopSummary: ExtractionHop[];
  bytesFetched: number;
  durationMs: number | null;
  result: unknown;
  brandProfileId: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Interní poznámka pro provozovatele. Do odpovědi API se nikdy nedostane. */
  internalNote?: string;
};

export type PublicExtractionView = {
  id: string;
  status: ExtractionStatus;
  input_url: string;
  normalized_url: string;
  error_code: string | null;
  hop_summary: ExtractionHop[];
  bytes_fetched: number;
  duration_ms: number | null;
  result: unknown;
  brand_profile_id: string | null;
  created_at: string;
  finished_at: string | null;
};

/**
 * Kritérium 53. SSRF je nebezpečný nejen tím, co provede, ale i tím, co
 * prozradí. Uživatel proto NIKDY nedostane syrové tělo odpovědi, IP adresu,
 * na kterou se šlo, ani text chyby ze síťové vrstvy: rozdíl mezi
 * `ECONNREFUSED` a `ETIMEDOUT` je informace o tom, jestli na dané adrese
 * něco běží.
 *
 * URL a stav v `hop_summary` zůstávají: uživatel je zadal a jsou jeho.
 */
export function publicExtraction(row: ServiceExtractionRow): PublicExtractionView {
  return {
    id: row.id,
    status: row.status,
    input_url: row.inputUrl,
    normalized_url: row.normalizedUrl,
    error_code: row.errorCode,
    hop_summary: row.hopSummary.map((hop) => ({
      url: hop.url,
      status: hop.status,
      ipClass: hop.ipClass,
    })),
    bytes_fetched: row.bytesFetched,
    duration_ms: row.durationMs,
    result: row.result,
    brand_profile_id: row.brandProfileId,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
  };
}

export type RequestExtractionDeps = {
  countExtractionsInLastHour: (workspaceId: string) => Promise<number>;
  countRunningExtractions: (workspaceId: string) => Promise<number>;
  insertExtraction: (row: {
    workspaceId: string;
    requestedBy: string;
    inputUrl: string;
    normalizedUrl: string;
    status: ExtractionStatus;
  }) => Promise<{ id: string; status: ExtractionStatus }>;
  enqueue: (queue: string, payload: Record<string, unknown>) => Promise<void>;
  writeAuditLog: (entry: Record<string, unknown>) => Promise<void>;
};

export type RequestExtractionLimits = {
  ratePerHour: number;
  concurrencyPerWorkspace: number;
};

export type RequestExtractionResult =
  | { ok: true; id: string; status: 202 }
  | { ok: false; code: 'rate_limited'; status: 429; retryAfterSeconds: number; limit: number }
  | { ok: false; code: 'conflict'; status: 409 }
  | { ok: false; code: string; status: 400 };

const URL_POLICY_DEFAULTS: Pick<UrlPolicy, 'blockedHosts'> = {
  blockedHosts: ['metadata.google.internal', 'metadata.goog', 'instance-data', 'metadata'],
};

export const DEFAULT_URL_POLICY: UrlPolicy = {
  allowHttp: true,
  allowedHosts: [],
  ...URL_POLICY_DEFAULTS,
};

export async function requestExtraction(
  params: { workspaceId: string; actorId: string; url: string; inferTone: boolean },
  limits: RequestExtractionLimits,
  deps: RequestExtractionDeps,
  policy: UrlPolicy = DEFAULT_URL_POLICY,
): Promise<RequestExtractionResult> {
  const used = await deps.countExtractionsInLastHour(params.workspaceId);
  if (used >= limits.ratePerHour) {
    // Vyčerpaný limit nenese informaci navíc, proto obecný kód z katalogu
    // části 1, ne vlastní `brand_rate_limited`.
    return {
      ok: false,
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 3600,
      limit: limits.ratePerHour,
    };
  }

  const running = await deps.countRunningExtractions(params.workspaceId);
  if (running >= limits.concurrencyPerWorkspace) {
    return { ok: false, code: 'conflict', status: 409 };
  }

  const normalized = normalizeBrandUrl(params.url, policy);
  if (!normalized.ok) {
    return { ok: false, code: normalized.code, status: 400 };
  }

  /*
   * DOPLNĚK PROTI PLÁNU. Plán se spoléhal jen na `normalizeBrandUrl`, jenže
   * ta zná zakázaná JMÉNA, ne zakázané ROZSAHY: `http://169.254.169.254/`
   * jí projde a požadavek by se zapsal i zařadil do fronty. Job by ho sice
   * o pár set milisekund později zablokoval, ale zbytečně: adresa v zakázaném
   * rozsahu je vidět hned a nemá smysl kvůli ní zakládat běh.
   */
  if (isIP(normalized.hostname) !== 0) {
    const verdict = classifyAddress(normalized.hostname);
    if (!verdict.allowed) {
      return { ok: false, code: 'brand_blocked_address', status: 400 };
    }
  }

  const inserted = await deps.insertExtraction({
    workspaceId: params.workspaceId,
    requestedBy: params.actorId,
    inputUrl: params.url,
    normalizedUrl: normalized.url,
    status: 'pending',
  });

  /*
   * `workspaceId` v nákladu není nadbytečný údaj, ale podmínka zpracování:
   * obsluha čte i zapisuje pod RLS a bez projektu nemá pod čím otevřít
   * transakci. Přečíst si ho z řádku nemůže, protože ten řádek se bez kontextu
   * projektu nedá načíst. Registr front P01 ho v `payloadFields` uvádí.
   */
  await deps.enqueue('content.brand_extract', {
    workspaceId: params.workspaceId,
    extractionId: inserted.id,
  });

  // Každý pokus se zapisuje do audit logu. Je to jedno ze tří zmírnění
  // zbytkového rizika binárního orákula, které přiznáváme.
  await deps.writeAuditLog({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    action: 'brand_extraction_requested',
    targetId: inserted.id,
    metadata: { normalizedUrl: normalized.url, inferTone: params.inferTone },
  });

  return { ok: true, id: inserted.id, status: 202 };
}
