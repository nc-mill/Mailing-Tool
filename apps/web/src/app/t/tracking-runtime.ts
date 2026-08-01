import { v7 as uuidv7 } from 'uuid';
import { loadConfig } from '@mlain/core/config';
import {
  EventBuffer,
  LinkCache,
  ProxyRangeIndex,
  TrackingDomainCache,
  buildTrackingKeyring,
  createClickHandler,
  createOpenHandler,
  createPublicTrackingRoutes,
  currentTrackingKeyId,
  insertMessageEvents,
  lookupMessage,
  type BufferedClick,
  type BufferedOpen,
  type MessageEventInsert,
  type TrackingKeyring,
} from '@mlain/core/tracking';

/**
 * ODCHYLKA OD PLÁNU, VĚDOMÁ A DOČASNÁ.
 *
 * Plán chce živé instance v `apps/web/src/lib/tracking-runtime.ts` a dodává je
 * Task 24, tedy mimo rozsah úkolů 1 až 21. Route handler by ale bez nich měl
 * viset na neexistujícím importu a `next build` i `tsc` by na něm spadly, takže
 * by celý web přestal jít přeložit kvůli souboru, který nikdo nevolá.
 *
 * Wiring je proto tady, vedle route handleru, a je složený VÝHRADNĚ z modulů,
 * které dodaly úkoly 1 až 21. Až Task 24 soubor v `lib/` založí, tenhle se
 * změní na jeden reexport a zmizí.
 *
 * Tři místa, která Task 24 doplní a která jsou tady schválně zjednodušená:
 *  - `consumeRateLimit` zatím nikoho neomezuje. Limity patří do
 *    `apps/web/src/lib/tracking-rate-limit.ts`, což je taky Task 24.
 *  - `isWebTrackingEnabled` nečte `workspaces.settings.tracking.web_tracking_enabled`.
 *    Kontrola registrované domény, tedy ta, která brání úniku identity na cizí
 *    web, platí i tak a je v `handle-click.ts`.
 *  - Vyprazdňování bufferu zapisuje do `message_events` přímo. Zařazení
 *    navazujícího jobu `tracking.process_engagement` přidává Task 25.
 */

const config = loadConfig();

// P01 rozkládá klíče už v konfiguraci a nechává si v `raw` původní zápis.
// Ten se posílá dál, protože rozklad na keyring vlastní kontrakt a druhý
// rozklad téhož řetězce by byl druhá implementace zmrazeného chování.
const keyring: TrackingKeyring = buildTrackingKeyring({
  secretKey: config.SECRET_KEY.raw,
  secretKeyPrevious: config.SECRET_KEY_PREVIOUS.map((generation) => generation.raw).join(','),
});

const proxyRanges = new ProxyRangeIndex([], {
  useAppleRelayRanges: config.TRACKING_APPLE_RELAY_RANGES,
});

const domains = new TrackingDomainCache({ refreshMs: 60_000 });
domains.start();

const links = new LinkCache({ capacity: 5_000, ttlMs: 900_000 });

type BufferedEvent = BufferedOpen | BufferedClick;

/**
 * Dohledá kampaň a kontakt ke každé položce dávky a zapíše je jako události.
 * Zpráva se hledá podle OBOU složek klíče, takže je to zásah do jedné partition.
 */
async function flush(batch: BufferedEvent[]): Promise<void> {
  const rows: MessageEventInsert[] = [];

  for (const item of batch) {
    const message = await lookupMessage({
      workspaceId: item.workspaceId,
      messageId: item.messageId,
      messageCreatedAt: item.messageCreatedAt,
    });
    // Nedohledaná zpráva je porušení invariantu I1. Čítač zvýšil lookupMessage,
    // událost se zahodí: bez kampaně ji není kam zařadit.
    if (message === null) continue;

    rows.push({
      id: uuidv7(),
      workspaceId: item.workspaceId,
      messageId: item.messageId,
      messageCreatedAt: message.createdAt,
      campaignId: message.campaignId,
      contactId: message.contactId,
      type: item.kind === 'open' ? 'open' : 'click',
      subtype: item.kind === 'open' ? item.openClass : item.clickClass,
      ts: item.occurredAt,
      linkId: item.kind === 'click' ? item.linkId : null,
      metadata: item.kind === 'click' ? { link_position: item.linkPosition } : {},
    });
  }

  await insertMessageEvents(rows);
}

const buffer = new EventBuffer<BufferedEvent>({
  flushMs: config.TRACKING_WRITER_FLUSH_MS,
  batchSize: config.TRACKING_WRITER_BATCH,
  capacity: config.TRACKING_WRITER_BATCH * 20,
  flush,
});

const handleOpen = createOpenHandler({
  keyring,
  proxyRanges,
  push: (item) => buffer.push(item),
});

const handleClick = createClickHandler({
  keyring,
  currentKeyId: currentTrackingKeyId(keyring),
  links,
  domains,
  push: (item) => buffer.push(item),
  lookupContactId: async (workspaceId, messageId, createdAt) => {
    const message = await lookupMessage({ workspaceId, messageId, messageCreatedAt: createdAt });
    return message?.contactId ?? null;
  },
  isWebTrackingEnabled: () => true,
  identityTokenTtlSeconds: config.TRACKING_IDENTITY_TOKEN_TTL_SECONDS,
  contactLookupTimeoutMs: 30,
});

/**
 * Klientská IP z hlaviček reverzní proxy. Bere se PRVNÍ položka
 * `X-Forwarded-For`, protože další si může dopsat kdokoliv po cestě.
 */
function clientIp(headers: Record<string, string | undefined>): string | null {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded !== undefined && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return headers['x-real-ip'] ?? null;
}

export const trackingRuntime = {
  keyring,
  domains,
  links,
  buffer,
  publicTrackingRoutes: createPublicTrackingRoutes({
    handleOpen,
    handleClick,
    consumeRateLimit: async () => true,
    clientIp,
  }),
};
