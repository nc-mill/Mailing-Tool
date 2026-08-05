import { createSystemContext } from '../../identity/context';
import { recordClick, recordTokenInvalid, trackingMetrics } from '../metrics';
import type { ClickClass } from '../types';
import type { TrackingKeyring } from '../tokens/keyring';
import { mintIdentityToken } from '../tokens/mint';
import { verifyTrackingToken } from '../tokens/verify';
import type { TrackingDomainCache } from '../domains/domain-cache';
import { normalizeHost } from '../domains/domain-cache';
import { appendQueryParam } from './append-query';
import { classifyClickHot } from './classify-click';
import type { LinkCache } from './link-cache';

export const EXPIRED_PATH = '/t/expired';

export const REDIRECT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
});

export type BufferedClick = {
  kind: 'click';
  workspaceId: string;
  messageId: string;
  messageCreatedAt: number;
  campaignId: string;
  linkId: string;
  linkPosition: number;
  occurredAt: Date;
  clickClass: ClickClass;
  ip: string | null;
};

export type ClickRequest = {
  token: string;
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  /** Syrový query řetězec příchozího požadavku. Slouží jen k tomu, aby bylo vidět, že se ignoruje. */
  query: string;
  now: Date;
};

export type ClickResponse = {
  status: 302;
  location: string;
  headers: Readonly<Record<string, string>>;
};

export type ClickHandlerDeps = {
  keyring: TrackingKeyring;
  currentKeyId: number;
  links: LinkCache;
  domains: TrackingDomainCache;
  push: (item: BufferedClick) => void;
  lookupContactId: (
    workspaceId: string,
    messageId: string,
    createdAt: number,
  ) => Promise<string | null>;
  isWebTrackingEnabled: (workspaceId: string) => boolean;
  identityTokenTtlSeconds: number;
  contactLookupTimeoutMs: number;
};

function expired(): ClickResponse {
  return { status: 302, location: EXPIRED_PATH, headers: REDIRECT_HEADERS };
}

export function createClickHandler(
  deps: ClickHandlerDeps,
): (request: ClickRequest) => Promise<ClickResponse> {
  return async function handleClick(request: ClickRequest): Promise<ClickResponse> {
    const startedAt = Date.now();

    // 1. ověření tokenu
    const result = verifyTrackingToken(request.token, ['c'], {
      keyring: deps.keyring,
      now: request.now,
    });
    if (!result.ok) {
      recordTokenInvalid(result.code);
      return expired();
    }
    if (result.fields.type !== 'c') return expired();
    const token = result.fields;

    // 2. cíl výhradně z databáze podle link_id, nikdy ze vstupu.
    // Projekt z ověřeného tokenu jde do cache i do dotazu, takže odkaz cizího
    // projektu se nedohledá už v cache, ne až kontrolou o řádek níž.
    const link = await deps.links.get(token.workspaceId, token.linkId);

    // 3. odkaz musí existovat a patřit témuž projektu jako token
    if (link === null || link.workspaceId !== token.workspaceId) return expired();

    // 4. klasifikace z hlaviček, pravidla 5 a 6 se dopočítají asynchronně
    const clickClass = classifyClickHot({
      userAgent: request.userAgent,
      method: request.method,
      headers: request.headers,
    });
    recordClick(clickClass);

    // 5. zápis do bufferu, odpověď se na databázi neblokuje
    deps.push({
      kind: 'click',
      workspaceId: token.workspaceId,
      messageId: token.messageId,
      messageCreatedAt: token.messageCreatedAt,
      campaignId: link.campaignId,
      linkId: link.id,
      linkPosition: link.position,
      occurredAt: request.now,
      clickClass,
      ip: request.ip,
    });

    // 6. a 7. identita se předává jen na vlastní doménu zákazníka
    let target = link.url;
    const host = normalizeHost(link.url);
    if (clickClass === 'human' && deps.isWebTrackingEnabled(token.workspaceId)) {
      /**
       * Kontext se vyrábí AŽ TADY a AŽ Z OVĚŘENÉHO TOKENU. Seznam povolených
       * domén se čte z `tracking_domains`, na které leží `ws_isolation`, takže
       * bez kontextu vrací dotaz nula řádků, `isAllowed` je vždycky nepravda
       * a `ml_token` se do cíle NIKDY nepřipojí. Přesně tak se ta vada chovala:
       * proklik fungoval, jen se návštěva webu s kontaktem nespojila.
       */
      const ctx = createSystemContext(token.workspaceId, 'tracking.click');
      if (await deps.domains.isAllowed(ctx, host)) {
        const contactId = await withTimeout(
          deps.lookupContactId(token.workspaceId, token.messageId, token.messageCreatedAt),
          deps.contactLookupTimeoutMs,
        );
        if (contactId !== null) {
          const minted = mintIdentityToken({
            workspaceId: token.workspaceId,
            contactId,
            campaignId: link.campaignId,
            ttlSeconds: deps.identityTokenTtlSeconds,
            keyring: deps.keyring,
            currentKeyId: deps.currentKeyId,
            now: request.now,
          });
          target = appendQueryParam(link.url, 'ml_token', minted.token);
        }
      }
    }

    trackingMetrics.redirectDuration.observe((Date.now() - startedAt) / 1000);
    return { status: 302, location: target, headers: REDIRECT_HEADERS };
  };
}

/**
 * Když dohledání kontaktu trvá dýl než strop, ml_token se nepřidá a přesměrování
 * proběhne bez něj. Ztráta propojení identity u jednoho kliku je nesrovnatelně
 * menší škoda než pomalé přesměrování pro člověka, který čeká na stránku.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise.catch(() => null), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
