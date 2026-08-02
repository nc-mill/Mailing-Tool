import { Agent } from 'undici';
import { createPinnedConnector } from './connector';
import type { SafeFetchRequest } from './safe-fetch';

/** Slušný crawler se představí. Bez toho nás část webů odmítne. */
export const TRANSPORT_USER_AGENT = 'MlainMailerBrandBot/1.0';

/**
 * Skutečná implementace `SafeFetchDeps.request`.
 *
 * Pro KAŽDÝ hop se staví nový `Agent` s konektorem připnutým na tu jednu
 * ověřenou IP. Sdílený agent s poolem spojení by tuhle vlastnost zrušil:
 * druhý hop by mohl recyklovat spojení navázané na adresu z prvního hopu,
 * a připnutí by přestalo platit přesně tam, kde na něm záleží.
 *
 * Agent se v `finally` zavírá, aby po sobě nenechával otevřené sockety.
 */
export function createUndiciRequest(userAgent = TRANSPORT_USER_AGENT): SafeFetchRequest {
  return async ({ url, pinnedIp, servername, limits, allowPrivateNetworks }) => {
    const agent = new Agent({
      connect: createPinnedConnector({
        pinnedIp,
        servername,
        allowPrivateNetworks,
        connectTimeoutMs: limits.timeouts.connect,
      }) as never,
      headersTimeout: limits.timeouts.headers,
      bodyTimeout: limits.timeouts.body,
      pipelining: 0,
    });

    try {
      const target = new URL(url);
      const response = await agent.request({
        origin: target.origin,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        // Přesměrování se nenásleduje: `Agent` je bez interceptoru `redirect`
        // nenásleduje sám a safeFetch si je řídí ručně, aby každý hop prošel
        // kontrolou adresy. Volba `maxRedirections` sem nepatří, `Agent` ji
        // v `RequestOptions` nezná a typová kontrola to hlásí.
        headers: {
          'user-agent': userAgent,
          accept: limits.acceptMimePrefixes.join(', '),
          'accept-encoding': 'gzip, deflate',
        },
      });

      const bodyChunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        total += buffer.byteLength;
        bodyChunks.push(buffer);
        // Tvrdý strop i tady, ne jen ve volajícím: stahovat tři gigabajty
        // a teprve pak je zahodit je samo o sobě útok.
        if (total > limits.maxBytes) {
          response.body.destroy();
          break;
        }
      }

      return {
        statusCode: response.statusCode,
        headers: response.headers as Record<string, string | string[] | undefined>,
        bodyChunks,
      };
    } finally {
      await agent.close();
    }
  };
}
