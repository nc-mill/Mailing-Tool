import { originHost } from '../domains/domain-cache';
import { hasPiiTraits } from '../identity/signature';
import { trackingMetrics } from '../metrics';
import { EVENT_NAME_RE, type EventSource } from '../types';
import { correctOccurredAt } from './clock-skew';
import type { PublicKeyOwner } from './public-key';
import { parseBatch, type IngestEvent } from './schema';
import { sanitizeProperties, type Finding, type PropertyLimits } from './sanitize-properties';
import { DEFAULT_STRIP_PARAMS, extractCampaign, sanitizeUrl } from './sanitize-url';

/**
 * Přijetí dávky událostí, viz plán P10 Task 26.
 *
 * Endpoint musí odpovědět do desítek milisekund, takže NEČEKÁ na zpracování:
 * zvaliduje, zařadí job a vrátí 202.
 *
 * Odpověď NIKDY neobsahuje žádná data o kontaktu. Nevrací `contact_id`,
 * e-mail ani informaci o tom, jestli je anonymní ID navázané. Kdyby to
 * dělala, stal by se z endpointu nástroj na zjišťování, kdo je návštěvník.
 */

const MAX_EVENT_BYTES = 8 * 1024;

export type IngestRequestMeta = { origin: string | undefined; ip?: string | null };

export type IngestResponse = {
  status: 202 | 400 | 401 | 403 | 413 | 422;
  body?: { accepted: number; rejected: number; findings?: Finding[] };
  problem?: { code: string; params?: Record<string, unknown> };
};

/**
 * Volání `identify` ve tvaru, ve kterém dorazilo z prohlížeče.
 *
 * NEODSTRAŇUJ TUHLE DUPLICITU. Vypadá jako zbytečná, není.
 * `sanitizeProperties` zkracuje dlouhé řetězce a zahazuje klíče nad limit,
 * takže traits po úklidu jsou JINÁ DATA než ta, která zákazník podepsal.
 * Kdyby se podpis ověřoval proti `properties`, neseděl by nikdy, odmítalo by
 * se každé `identify` s delším jménem nebo s víc vlastnostmi, a nikde by
 * nebylo vidět proč: server by hlásil „podpis nesedí" a zákazník by měl
 * na své straně podpis, který je správně.
 *
 * Ověřuje se proto proti téhle netknuté kopii. Do `web_events` jde dál
 * uklizená verze, takže limity vlastností nikdo neobchází.
 */
export type IdentifyPayload = {
  externalId: string;
  traits: Record<string, unknown>;
  signature?: string;
};

/** Tvar, ve kterém dávka odchází do fronty `event.process`. */
export type PreparedEvent = {
  id: string;
  name: string;
  occurredAt: string;
  sessionId: string | null;
  page?: Record<string, unknown>;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  /** Jen u události `identify`. */
  identify?: IdentifyPayload;
};

/** Jméno události, kterou SDK posílá jako volání `identify`. */
export const IDENTIFY_EVENT_NAME = 'identify';

type IdentifyParse =
  | { ok: true; payload: IdentifyPayload }
  | { ok: false; code: 'validation_failed' | 'tracking_identify_unsigned_pii' };

/**
 * Rozbalení a kontrola volání `identify`, viz specifikace 3.6.3.
 *
 * Běží v odpovědi na `/e/track`, protože je to čistý výpočet bez jediného
 * dotazu do databáze. Vlastní ověření podpisu klíče z databáze potřebuje,
 * a proto je až ve workeru.
 */
function parseIdentify(properties: Record<string, unknown> | undefined): IdentifyParse {
  const externalId = properties?.['external_id'];
  if (typeof externalId !== 'string' || externalId === '' || externalId.includes('\n')) {
    // Bajt 0x0A v identifikátoru dělá podepisovaný vstup nejednoznačným, takže
    // se odmítá tady, ne aby se dole hádalo (3.6.3).
    return { ok: false, code: 'validation_failed' };
  }

  const rawTraits = properties?.['traits'];
  if (rawTraits !== undefined && (typeof rawTraits !== 'object' || rawTraits === null)) {
    return { ok: false, code: 'validation_failed' };
  }
  const traits = (rawTraits ?? {}) as Record<string, unknown>;

  const rawSignature = properties?.['signature'];
  if (rawSignature !== undefined && typeof rawSignature !== 'string') {
    return { ok: false, code: 'validation_failed' };
  }
  const signature = rawSignature === undefined || rawSignature === '' ? undefined : rawSignature;

  // Kód z prohlížeče vidí každý a kdokoli ho může zavolat s libovolným
  // e-mailem. Bez tohohle pravidla by šlo unést cizí kontakt.
  if (signature === undefined && hasPiiTraits(traits)) {
    return { ok: false, code: 'tracking_identify_unsigned_pii' };
  }

  return {
    ok: true,
    payload: { externalId, traits, ...(signature === undefined ? {} : { signature }) },
  };
}

export type EventProcessPayload = {
  workspaceId: string;
  anonymousId: string | null;
  source: Extract<EventSource, 'web' | 'server'>;
  events: PreparedEvent[];
  /**
   * Host z hlavičky `Origin`, který právě prošel kontrolou povolených domén.
   * Nese se dál PROTO, aby ověření domény zapsal worker a ne tahle cesta:
   * odpověď `/e/track` má být v desítkách milisekund a `UPDATE` do ní nepatří.
   * U serverového volání bez `Origin` je `null`, tam se nic neověřuje.
   */
  originHost: string | null;
};

export type IngestServiceDeps = {
  resolvePublicKey: (key: string) => Promise<PublicKeyOwner | null>;
  isOriginAllowed: (workspaceId: string, origin: string) => boolean;
  allowServersidePublicKey: (workspaceId: string) => boolean;
  /** Vypnuté měření webu se chová jako 202 bez zápisu, viz komentář u `accept`. */
  isWebTrackingEnabled?: (workspaceId: string) => boolean;
  limits: PropertyLimits;
  /**
   * Konfigurace sadu odstraňovaných parametrů jen ROZŠIŘUJE, nikdy nezkracuje.
   * `TRACKING_STRIP_QUERY_PARAMS` má výchozí hodnotu prázdný seznam, takže
   * kdyby se předaná hodnota brala místo výchozí sady, vypnula by čištění
   * adres na každé instalaci, kde tu proměnnou nikdo nenastavil. Tedy na všech.
   */
  stripParams?: readonly string[];
  enqueue: (payload: EventProcessPayload) => Promise<void>;
  now: () => Date;
  /**
   * Zdroj, pod kterým se událost uloží. `web` je prohlížeč, `server` serverové
   * volání s privátním klíčem. Bez tohohle parametru by hodnota `server` byla
   * mrtvá položka slovníku a serverovou událost by nešlo odlišit
   * od prohlížečové.
   */
  source?: Extract<EventSource, 'web' | 'server'>;
};

export function createIngestService(deps: IngestServiceDeps) {
  const stripParams = [...DEFAULT_STRIP_PARAMS, ...(deps.stripParams ?? [])];
  const source = deps.source ?? 'web';

  return {
    async accept(input: unknown, meta: IngestRequestMeta): Promise<IngestResponse> {
      const startedAt = Date.now();
      const parsed = parseBatch(input);
      if (!parsed.ok) {
        return {
          status: parsed.status as IngestResponse['status'],
          problem: { code: parsed.code, ...(parsed.params ? { params: parsed.params } : {}) },
        };
      }
      const batch = parsed.batch;

      const owner = await deps.resolvePublicKey(batch.key);
      if (owner === null) return { status: 401, problem: { code: 'unauthenticated' } };

      // CORS chrání prohlížeč před ČTENÍM odpovědi, tahle kontrola chrání data
      // před ZÁPISEM. Bez ní by kdokoli s veřejným klíčem ze zdrojáku cizí
      // stránky psal do cizího projektu.
      if (meta.origin === undefined || meta.origin === '') {
        if (!deps.allowServersidePublicKey(owner.workspaceId)) {
          return { status: 403, problem: { code: 'origin_not_allowed' } };
        }
      } else if (!deps.isOriginAllowed(owner.workspaceId, meta.origin)) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      /**
       * Vypnuté měření webu vrací 202 s nulou přijatých, ne chybu. SDK na cizím
       * webu by z chyby udělalo opakování s backoffem a bušilo by donekonečna;
       * tady se má prostě přestat sbírat.
       */
      if (deps.isWebTrackingEnabled?.(owner.workspaceId) === false) {
        return { status: 202, body: { accepted: 0, rejected: 0 } };
      }

      const serverNow = deps.now();
      const sentAt = new Date(batch.sent_at);
      const findings: Finding[] = [];
      const prepared: PreparedEvent[] = [];
      let rejected = 0;

      batch.events.forEach((event, index) => {
        const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
        if (size > MAX_EVENT_BYTES) {
          rejected += 1;
          findings.push({
            code: 'tracking_event_too_large',
            severity: 'warning',
            message: 'Událost je příliš velká.',
            params: { index, size_bytes: size },
          });
          return;
        }
        if (!EVENT_NAME_RE.test(event.name)) {
          rejected += 1;
          findings.push({
            code: 'tracking_invalid_event_name',
            severity: 'warning',
            message: 'Jméno události smí obsahovat jen malá písmena, číslice a podtržítko.',
            params: { index, name: event.name },
          });
          return;
        }
        let identify: IdentifyPayload | undefined;
        if (event.name === IDENTIFY_EVENT_NAME) {
          const parsed = parseIdentify(event.properties);
          if (!parsed.ok) {
            rejected += 1;
            findings.push({
              code: parsed.code,
              severity: 'warning',
              message:
                parsed.code === 'tracking_identify_unsigned_pii'
                  ? 'Volání identify nesmí nést osobní údaje bez podpisu.'
                  : 'Volání identify nemá platný external_id ani traits.',
              params: { index },
            });
            return;
          }
          identify = parsed.payload;
        }

        prepared.push(
          prepareEvent(
            event,
            index,
            { sentAt, serverNow, stripParams, limits: deps.limits },
            findings,
            identify,
          ),
        );
      });

      if (prepared.length > 0) {
        trackingMetrics.ingestEvents.inc({ result: 'accepted' }, prepared.length);
      }
      if (rejected > 0) trackingMetrics.ingestEvents.inc({ result: 'rejected' }, rejected);
      for (const finding of findings) {
        if (finding.code.startsWith('tracking_properties_')) {
          trackingMetrics.ingestTruncated.inc({ limit: finding.code });
        }
      }

      if (prepared.length > 0) {
        await deps.enqueue({
          workspaceId: owner.workspaceId,
          anonymousId: batch.anonymous_id ?? null,
          source,
          events: prepared,
          // Origin sem doputuje jedině povolený: kdyby povolený nebyl, funkce
          // skončila o kus výš chybou 403.
          originHost: originHost(meta.origin),
        });
      }

      trackingMetrics.ingestDuration.observe((Date.now() - startedAt) / 1000);

      return {
        status: 202,
        body: {
          accepted: prepared.length,
          rejected,
          ...(findings.length > 0 ? { findings } : {}),
        },
      };
    },
  };
}

type PrepareOptions = {
  sentAt: Date;
  serverNow: Date;
  stripParams: readonly string[];
  limits: PropertyLimits;
};

function prepareEvent(
  event: IngestEvent,
  index: number,
  options: PrepareOptions,
  findings: Finding[],
  identify?: IdentifyPayload,
): PreparedEvent {
  const corrected = correctOccurredAt({
    occurredAt: new Date(event.occurred_at),
    sentAt: options.sentAt,
    serverNow: options.serverNow,
  });

  const page =
    event.page === undefined
      ? undefined
      : {
          ...event.page,
          url: sanitizeUrl(event.page.url, options.stripParams),
          ...(event.page.referrer === undefined
            ? {}
            : { referrer: sanitizeUrl(event.page.referrer, options.stripParams) }),
          ...(event.page.search === undefined
            ? {}
            : { search: stripSearch(event.page.search, options.stripParams) }),
        };

  const sanitized = sanitizeProperties(event.properties ?? {}, options.limits);
  for (const finding of sanitized.findings) {
    findings.push({ ...finding, params: { ...finding.params, index } });
  }

  const campaign = event.page === undefined ? undefined : extractCampaign(event.page.url);

  return {
    id: event.id,
    name: event.name,
    occurredAt: corrected.occurredAt.toISOString(),
    sessionId: event.session_id ?? null,
    ...(page === undefined ? {} : { page }),
    properties: sanitized.value,
    context: {
      ...event.context,
      ...(campaign === undefined ? {} : { campaign }),
      clock_skew_ms: corrected.clockSkewMs,
    },
    ...(identify === undefined ? {} : { identify }),
  };
}

/**
 * `page.search` je samostatné pole a čistí se stejně jako adresa.
 *
 * Doplněk proti plánu, ne odchylka: plán čistil jen `url` a `referrer`, jenže
 * SDK posílá query řetězec i zvlášť. Bez tohohle kroku by se `?token=…`
 * z adresy smazal a o řádek níž zůstal celý.
 */
function stripSearch(search: string, stripParams: readonly string[]): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const strip = new Set(stripParams.map((p) => p.toLowerCase()));
  // Dopředu do pole, viz zdůvodnění v `sanitize-url.ts`: mazání během živého
  // iterátoru přeskakuje položky.
  const names = Array.from(params.keys());
  for (const name of names) {
    if (strip.has(name.toLowerCase())) params.delete(name);
  }
  const out = params.toString();
  return out === '' ? '' : `?${out}`;
}
