import { buildModel } from '../../ai/build-model';
import { decryptApiKey } from '../../ai/credential-service';
import { createMeteredFetch } from '../../ai/metered-fetch';
import { loadCredential } from '../../ai/repo';
import { factories } from '../../ai/sdk/factories';
import { loadConfig } from '../../config/index';
import { createLogger, type Logger } from '../../logging/logger';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { analyzePage } from '../extract/analyze';
import { collectStylesheetUrls, parseDocument } from '../extract/html';
import { collectLogoCandidates } from '../extract/logo';
import { inferTone } from '../extract/tone';
import {
  failStaleExtractions,
  findExtraction,
  finishExtraction,
  markRunning,
} from '../repo/extractions.repo';
import { insertBrandProfile } from '../repo/profiles.repo';
import { createBrandRuntime } from '../runtime';
import { enqueueBrandJob } from './enqueue';
import type { BrandExtractDeps } from './brand-extract';

/**
 * Strop přesměrování. Konfigurace pro něj proměnnou NEMÁ (schéma vlastní P01),
 * a je to správně: kritérium T10 zní „čtvrté přesměrování je
 * `brand_too_many_redirects`", tedy tři povolené hopy. Nastavitelný strop by
 * z bezpečnostního pravidla udělal doporučení.
 */
const MAX_REDIRECTS = 3;

let loggerInstance: Logger | null = null;

function brandLogger(): Logger {
  loggerInstance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'debug',
    format: 'json',
    mode: 'worker',
  });
  return loggerInstance;
}

/** Jméno profilu. Uživatel ho přejmenuje, tohle je jen první rozumný pokus. */
function profileNameFor(finalUrl: string): string {
  try {
    return new URL(finalUrl).hostname.replace(/^www\./, '');
  } catch {
    return finalUrl.slice(0, 120);
  }
}

/**
 * Kompoziční kořen extrakce značky.
 *
 * `runBrandExtraction` bere všechny závislosti parametrem, aby šlo otestovat
 * bez sítě a bez databáze. Protějškem k tomu MUSÍ být místo, kde se ty
 * závislosti jednou opravdu sestaví ze skutečného resolveru, skutečného
 * přenosu a skutečného databázového handle. Tímhle místem je tenhle soubor
 * a je jediné (plán P15, rozhodnutí D12).
 *
 * Bez něj má `createBrandRuntime` nula volajících, `safeFetch` nula spotřebitelů
 * a extrakce by nešla ven vůbec, přestože každá vrstva pod ní má zelený test.
 *
 * Továrna je PER ÚLOHA, ne per proces: každý běh patří jednomu projektu
 * a všechna čtení i zápisy jdou pod jeho kontextem, takže na ně dopadá RLS
 * úplně stejně jako na požadavek z API. `loadConfig()` se proto volá uvnitř
 * továrny, ne na úrovni modulu, kde by shodila každý jednotkový test, který se
 * souboru jen dotkne.
 *
 * Vstupem je `WorkspaceContext`, ne `workspaceId: string`, a je to podstatný
 * rozdíl, ne kosmetika. Kontext je branded typ, který se dá vyrobit jedině
 * v `identity/context.ts`, takže nemůže vzniknout z řetězce, kterému nikdo
 * neručí. Tenhle soubor otevírá transakce a čte i zapisuje podle toho, co
 * dostane; kdyby bral holé id, byl by jediným místem, kde se o izolaci
 * rozhoduje bez důkazu. Vyrábí ho volající, tedy obsluha fronty, z náplně
 * úlohy. Hlídá to `identity/scope.test.ts`.
 */
export function createBrandExtractDeps(ctx: WorkspaceContext): BrandExtractDeps {
  const config = loadConfig();
  const logger = brandLogger();

  /**
   * Skutečný DNS resolver a skutečný přenos přes undici s připnutou IP.
   * Sestavuje se jednou za úlohu, aby se spojení nedržela mezi běhy.
   */
  const runtime = createBrandRuntime({
    config: {
      dnsServers: config.BRAND_FETCH_DNS_SERVERS,
      timeouts: {
        dns: config.BRAND_FETCH_DNS_TIMEOUT_MS,
        connect: config.BRAND_FETCH_CONNECT_TIMEOUT_MS,
        headers: config.BRAND_FETCH_HEADERS_TIMEOUT_MS,
        body: config.BRAND_FETCH_BODY_TIMEOUT_MS,
      },
      maxHtmlBytes: config.BRAND_FETCH_MAX_HTML_BYTES,
      maxCssBytes: config.BRAND_FETCH_MAX_CSS_BYTES,
      maxImageBytes: config.BRAND_FETCH_MAX_IMAGE_BYTES,
      maxCssFiles: config.BRAND_FETCH_MAX_CSS_FILES,
      maxImageFiles: config.BRAND_FETCH_MAX_IMAGE_FILES,
      allowHttp: config.BRAND_FETCH_ALLOW_HTTP,
      allowPrivateNetworks: config.BRAND_FETCH_ALLOW_PRIVATE_NETWORKS,
      allowedHosts: config.BRAND_FETCH_ALLOWED_HOSTS,
      blockedHosts: config.BRAND_FETCH_BLOCKED_HOSTS,
      maxRedirects: MAX_REDIRECTS,
      respectRobots: config.BRAND_FETCH_RESPECT_ROBOTS,
      appUrl: config.APP_URL,
    },
  });

  return {
    loadExtraction: async (id) => {
      const row = await withWorkspace(ctx, (tx) => findExtraction(tx, id));
      if (row === null) {
        // Buď řádek neexistuje, nebo patří jinému projektu a RLS ho nepustila.
        // Rozlišovat to nemá smysl: obojí znamená, že tuhle úlohu nemá kdo
        // zpracovat, a tichý úspěch by nechal záznam viset v `pending`.
        throw new Error(`Extrakce ${id} v projektu ${ctx.workspaceId} neexistuje.`);
      }
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        status: row.status,
        normalizedUrl: row.normalizedUrl,
        /*
         * Odvození tónu je instalační přepínač, ne pole řádku: tabulka
         * `brand_extractions` sloupec pro něj nemá (schéma vlastní P03)
         * a náklad fronty je zmrazený na `workspace_id` a `extraction_id`
         * (registr front vlastní P01). Přání z těla požadavku `infer_tone`
         * se proto zapíše do auditu a rozhoduje instalační nastavení.
         */
        inferTone: config.BRAND_EXTRACTION_INFER_TONE,
      };
    },

    markRunning: async (id) => {
      const taken = await withWorkspace(ctx, (tx) => markRunning(tx, id));
      if (!taken) {
        // Řádek už někdo převzal. Pokračovat by znamenalo stáhnout cizí web
        // podruhé a přepsat výsledek prvního běhu.
        throw new Error(`Extrakci ${id} už převzal jiný běh, tahle úloha končí.`);
      }
    },

    finish: (input) => withWorkspace(ctx, (tx) => finishExtraction(tx, input)),

    checkRobots: (url) => runtime.checkRobots(url),
    fetchPage: (url) => runtime.fetchPage(url),
    fetchAssets: (urls) => runtime.fetchAssets(urls),

    // `parseDocument` z `extract/html` bere jen HTML; základní adresa se
    // uplatní až při sběru odkazů, kterým se předává zvlášť.
    parseDocument: (html) => parseDocument(html),
    collectStylesheetUrls: (parsed, baseUrl) => collectStylesheetUrls(parsed, baseUrl),
    collectLogoCandidates: (parsed, baseUrl) => collectLogoCandidates(parsed, baseUrl),

    /**
     * Analýza stažené stránky a založení profilu.
     *
     * `analyzePage` je čistá funkce: nic neměří ani neukládá, jen odvodí paletu,
     * písmo a kandidáty na logo. Uložení loga jako assetu tady schválně NENÍ,
     * protože měření rozměrů (`sharp`) ani úložiště assetů doména značky nemá;
     * `analyzePage` to hlásí varováním `logo_not_measured` a profil vzniká
     * s `logo_asset_id = NULL`. Kritérium 52 tím zůstává splněné: web bez loga
     * a bez barev uspěje s výchozí paletou a varováním.
     */
    buildBrandProfile: async ({ workspaceId, finalUrl, html, assets }) => {
      const analysis = analyzePage({ html, finalUrl, assets });
      const created = await withWorkspace(ctx, (tx) =>
        insertBrandProfile(tx, {
          workspaceId,
          name: profileNameFor(finalUrl),
          sourceUrl: finalUrl,
          logoAssetId: null,
          logoDarkAssetId: null,
          palette: analysis.palette,
          typography: analysis.typography,
        }),
      );
      return { brandProfileId: created.id, warnings: analysis.warnings };
    },

    /**
     * Odvození tónu z viditelného textu.
     *
     * KRITÉRIUM 7b: klíč pochází výhradně z databáze a `buildModel` se nezavolá
     * dřív, než klíč skutečně je. Projekt bez klíče tedy neudělá jediné odchozí
     * volání a extrakce doběhne bez tónu, protože tón je ozdoba, ne podmínka.
     */
    inferTone: async ({ text }) => {
      const enabled = config.AI_ENABLED && config.BRAND_EXTRACTION_INFER_TONE;
      const stored = enabled
        ? await withWorkspace(ctx, (tx) => loadCredential(tx, { credentialId: null }))
        : null;
      if (stored === null) {
        return { tone: null, warnings: ['tone_inference_disabled'] };
      }

      const handle = buildModel(
        {
          provider: stored.provider,
          apiKey: decryptApiKey({ workspaceId: ctx.workspaceId, stored: stored.stored }),
          baseUrl: stored.baseUrl,
        },
        stored.defaultModel,
        {
          // Měřený fetch: timeout, doba trvání a redakce hlaviček s klíčem.
          fetchImpl: createMeteredFetch({ timeoutMs: config.AI_REQUEST_TIMEOUT_MS }),
          factories,
          allowCustomBaseUrl: config.AI_ALLOW_CUSTOM_BASE_URL,
        },
      );

      /*
       * Adaptér nad AI SDK se natahuje AŽ TADY, ne importem na úrovni modulu.
       * Bez klíče se sem běh nedostane, takže projekt bez AI si celé SDK ani
       * nenačte a job zůstane lehký.
       */
      const { generateStructured } = await import('../../ai/sdk');

      return inferTone(
        { text, language: config.DEFAULT_LOCALE, model: handle.model },
        {
          inferToneEnabled: true,
          generateStructured: (input) => generateStructured(input),
        },
      );
    },

    /**
     * Odchozí událost projektu.
     *
     * Zápis do `webhook_events` a zařazení fan-outu jde v JEDNÉ transakci. Bez
     * zařazení by událost v tabulce ležela a nikdo by ji nerozeslal:
     * `fanoutEvent` volá výhradně job `platform.webhook_fanout` a ten se sám
     * nezařadí. Náklad toho jobu je snake_case, protože přesně tak ho čte
     * `platform/jobs/webhook_fanout.ts`.
     */
    emitWebhookEvent: async (event, payload) => {
      await withWorkspace(ctx, async (tx) => {
        const eventId = await emitWebhookEvent(tx, {
          workspaceId: ctx.workspaceId,
          type: event,
          occurredAt: new Date(),
          data: payload,
        });
        await enqueueBrandJob(tx, 'platform.webhook_fanout', {
          event_id: eventId,
          workspace_id: ctx.workspaceId,
        });
      });
    },

    // Podrobnosti o průběhu jdou na úroveň debug, kam se dostane jen
    // provozovatel. Uživateli se posílá jen `hop_summary` bez syrových IP.
    logDebug: (payload, message) => logger.debug(payload, message),
  };
}

/**
 * Závislosti úklidu zaseknutých běhů.
 *
 * `sweepStaleExtractions` je hotové a otestované, ale NEMÁ VOLAJÍCÍHO: registr
 * front P01 pro něj frontu nemá a je zmrazený, takže se úklid nedá zapojit bez
 * změny cizího souboru. Továrna tu je proto, aby zapojení bylo na jeden řádek
 * v okamžiku, kdy fronta vznikne, a aby bylo vidět, že chybí právě ta fronta,
 * ne zápisová část repozitáře.
 *
 * Kontext si vyrábí VOLAJÍCÍ, stejně jako u extrakce: úklid běží nad jedním
 * projektem a rozprostření po projektech je práce dispečera, který jediný ví,
 * odkud výčet projektů vzít.
 */
export function createBrandSweepDeps(ctx: WorkspaceContext): {
  failStaleExtractions: (cutoff: Date, code: string) => Promise<number>;
} {
  return {
    failStaleExtractions: (cutoff, code) =>
      withWorkspace(ctx, (tx) => failStaleExtractions(tx, cutoff, code)),
  };
}
