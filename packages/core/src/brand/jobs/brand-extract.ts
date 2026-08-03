import { assertTransition, type ExtractionHop, type ExtractionStatus } from '../brand-service';
import type { ParsedDocument } from '../extract/html';

/** Bez opakování: opakovat stejný pokus o SSRF není žádoucí a uživatel klikne znovu. */
export const RETRY_LIMIT = 0;
export const STALE_RUNNING_MS = 5 * 60 * 1000;

/** Kódy, které znamenají „zablokováno", ne „selhalo". */
const BLOCKING_CODES = new Set([
  'brand_robots_disallowed',
  'brand_blocked_address',
  'brand_host_not_allowed',
  'brand_scheme_not_allowed',
  'brand_port_not_allowed',
  'brand_credentials_in_url',
]);

export type BrandExtractDeps = {
  loadExtraction: (id: string) => Promise<{
    id: string;
    workspaceId: string;
    status: ExtractionStatus;
    normalizedUrl: string;
    inferTone: boolean;
  }>;
  markRunning: (id: string) => Promise<void>;
  finish: (params: {
    id: string;
    status: ExtractionStatus;
    errorCode: string | null;
    hopSummary: ExtractionHop[];
    bytesFetched: number;
    durationMs: number;
    result: unknown;
    brandProfileId: string | null;
  }) => Promise<void>;
  checkRobots: (url: string) => Promise<{ allowed: boolean; code?: string }>;
  fetchPage: (url: string) => Promise<
    | {
        ok: true;
        finalUrl: string;
        status: number;
        headers: Record<string, string>;
        body: Buffer;
        hops: ExtractionHop[];
        bytesRead: number;
      }
    | { ok: false; code: string; hops: ExtractionHop[]; bytesRead: number }
  >;
  fetchAssets: (urls: readonly string[]) => Promise<Array<{ url: string; body: Buffer }>>;
  /**
   * Parsování stažené stránky a sběr kandidátů. Bez nich by `fetchAssets`
   * nemělo co stahovat a paleta by se odvozovala jen z inline HTML.
   */
  parseDocument: (html: string, baseUrl: string) => ParsedDocument;
  collectStylesheetUrls: (parsed: ParsedDocument, baseUrl: string) => string[];
  collectLogoCandidates: (parsed: ParsedDocument, baseUrl: string) => Array<{ url: string }>;
  buildBrandProfile: (params: {
    workspaceId: string;
    finalUrl: string;
    html: string;
    assets: Array<{ url: string; body: Buffer }>;
  }) => Promise<{ brandProfileId: string; warnings: string[] }>;
  inferTone: (params: { workspaceId: string; text: string }) => Promise<{
    tone: unknown;
    warnings: string[];
  }>;
  emitWebhookEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  logDebug: (payload: Record<string, unknown>, message: string) => void;
};

export async function runBrandExtraction(
  job: { extractionId: string },
  deps: BrandExtractDeps,
): Promise<void> {
  const startedAt = Date.now();
  const extraction = await deps.loadExtraction(job.extractionId);

  assertTransition(extraction.status, 'running');
  await deps.markRunning(extraction.id);

  const fail = async (code: string, hops: ExtractionHop[], bytes: number) => {
    const status: ExtractionStatus = BLOCKING_CODES.has(code) ? 'blocked' : 'failed';
    assertTransition('running', status);
    await deps.finish({
      id: extraction.id,
      status,
      errorCode: code,
      hopSummary: hops,
      bytesFetched: bytes,
      durationMs: Date.now() - startedAt,
      result: null,
      brandProfileId: null,
    });
    await deps.emitWebhookEvent('brand.extraction_completed', {
      extractionId: extraction.id,
      status,
      url: extraction.normalizedUrl,
      warnings: [],
    });
  };

  const robots = await deps.checkRobots(extraction.normalizedUrl);
  if (!robots.allowed) {
    await fail(robots.code ?? 'brand_robots_unavailable', [], 0);
    return;
  }

  const page = await deps.fetchPage(extraction.normalizedUrl);
  if (!page.ok) {
    await fail(page.code, page.hops, page.bytesRead);
    return;
  }

  const html = page.body.toString('utf8');

  /*
   * Kandidáty je nutné nejdřív posbírat ze stažené stránky. Dřívější podoba
   * plánu volala `fetchAssets([])` s natvrdo prázdným polem, takže se externí
   * stylopisy, logo ani písma nikdy nestáhly: `buildBrandProfile` dostal
   * vždycky prázdné pole a paleta se odvozovala jen z inline HTML. Na webu,
   * který má barvy v externím CSS (tedy prakticky na každém), by z toho vyšla
   * výchozí paleta a varování „logo nenalezeno", i kdyby stránka obojí měla.
   */
  const parsed = deps.parseDocument(html, page.finalUrl);
  const assetUrls = [
    ...deps.collectStylesheetUrls(parsed, page.finalUrl),
    ...deps.collectLogoCandidates(parsed, page.finalUrl).map((candidate) => candidate.url),
  ];
  const assets = await deps.fetchAssets(assetUrls);

  const profile = await deps.buildBrandProfile({
    workspaceId: extraction.workspaceId,
    finalUrl: page.finalUrl,
    html,
    assets,
  });

  const tone = extraction.inferTone
    ? await deps.inferTone({ workspaceId: extraction.workspaceId, text: html })
    : { tone: null, warnings: ['tone_inference_disabled'] };

  const warnings = [...profile.warnings, ...tone.warnings];

  // Podrobnosti o průběhu jdou do serverového logu na úrovni debug, kam se
  // dostane jen provozovatel. Uživateli se posílá jen `hop_summary`.
  deps.logDebug(
    { extractionId: extraction.id, hops: page.hops.length, assets: assets.length },
    'brand extraction finished',
  );

  assertTransition('running', 'succeeded');
  await deps.finish({
    id: extraction.id,
    status: 'succeeded',
    errorCode: null,
    // Do hop_summary jde třída adresy, nikdy syrová IP.
    hopSummary: page.hops,
    bytesFetched: page.bytesRead,
    durationMs: Date.now() - startedAt,
    result: { warnings, tone: tone.tone },
    brandProfileId: profile.brandProfileId,
  });

  await deps.emitWebhookEvent('brand.extraction_completed', {
    extractionId: extraction.id,
    status: 'succeeded',
    url: extraction.normalizedUrl,
    brandProfileId: profile.brandProfileId,
    warnings,
  });
}

/**
 * Kdyby worker spadl uprostřed, zůstane záznam v `running` navždy. Úklid ho
 * po pěti minutách převede na `failed` s kódem `brand_timeout`.
 */
export async function sweepStaleExtractions(
  params: { now: Date },
  deps: { failStaleExtractions: (cutoff: Date, code: string) => Promise<number> },
): Promise<{ failed: number }> {
  const cutoff = new Date(params.now.getTime() - STALE_RUNNING_MS);
  const failed = await deps.failStaleExtractions(cutoff, 'brand_timeout');
  return { failed };
}

/*
 * Obsluha fronty tady SCHVÁLNĚ NENÍ.
 *
 * Dřív tu stál `handler` s podpisem `(job: { data, deps })`, jenže `QueueHandler`
 * z registru front je `(jobs: readonly QueueJob[]) => Promise<void>`: pg-boss
 * doručuje dávku a žádné `deps` s ní nepředává. Takovou obsluhu neměl worker
 * čím zavolat, takže se fronta nedala zaregistrovat a extrakce zůstávala
 * v `pending`.
 *
 * Skutečná obsluha je v `brand-extract-handler.ts`, závislosti skládá
 * `brand-extract-deps.ts`. Tenhle modul zůstává čistý: nemá jediný import
 * z databáze ani ze sítě, takže jde otestovat bez obojího.
 */
