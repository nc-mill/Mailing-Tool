import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { assertUrlAllowed, isBlockedAddress, SsrfBlockedError, type SsrfPolicy } from './ssrf';

/** 3.8: čteme nejvýš 8 kB odpovědi, zbytek zahodíme. */
export const MAX_RESPONSE_BYTES = 8 * 1024;

export type SafeRequestInput = {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: string;
  policy: SsrfPolicy;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
};

export type SafeResponse = { status: number; body: string; durationMs: number };

/**
 * Jedno pravidlo z 3.8 je nepodmíněné a nejde vypnout ani jednomu volajícímu:
 * DNS se rozřeší, výsledné adresy se zkontrolují proti blocklistu a spojení se
 * naváže na OVĚŘENOU IP adresu, a to při KAŽDÉM požadavku, ne jen při ukládání.
 * Bez toho existuje DNS rebinding: jméno projde validací a při doručení se
 * přeloží na 169.254.169.254.
 *
 * Proto se používá node:https s vlastním `lookup`, ne fetch: fetch nedovoluje
 * připnout adresu ani spolehlivě zakázat přesměrování na úrovni socketu.
 */
export async function safeRequest(input: SafeRequestInput): Promise<SafeResponse> {
  const url = assertUrlAllowed(input.url, input.policy);
  const startedAt = Date.now();

  const resolved = await dnsLookup(url.hostname, { all: true, verbatim: true }).catch(() => {
    throw new SsrfBlockedError('dns_failed');
  });
  if (resolved.length === 0) throw new SsrfBlockedError('dns_empty');

  const usable = input.policy.allowPrivateNetworks
    ? resolved
    : resolved.filter((entry) => !isBlockedAddress(entry.address));
  if (usable.length === 0) throw new SsrfBlockedError('resolved_to_blocked_address');

  const pinned = usable[0]!;
  const isHttps = url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;

  // `servername` se přidává jen u https. Přiřadit `undefined` do volitelného
  // pole nejde: monorepo běží s `exactOptionalPropertyTypes: true`.
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: input.method,
    headers: { ...input.headers, 'Content-Length': String(Buffer.byteLength(input.body, 'utf8')) },
    // Připnutí na ověřenou adresu. servername zůstává původní jméno,
    // takže TLS certifikát se ověřuje proti němu, ne proti IP.
    lookup: (_hostname, _options, callback) => {
      (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
        null,
        pinned.address,
        pinned.family,
      );
    },
    ...(isHttps ? { servername: url.hostname } : {}),
  };

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = send(options, (res) => {
      let received = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        if (received >= MAX_RESPONSE_BYTES) return;
        const room = MAX_RESPONSE_BYTES - received;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        received += Math.min(chunk.length, room);
      });
      res.on('end', () => {
        clearTimeout(totalTimer);
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          durationMs: Date.now() - startedAt,
        });
      });
    });

    // Přesměrování nenásledujeme vůbec (3.8). node:http je nenásleduje samo,
    // takže 3xx propadne do klasifikace odpovědi jako každý jiný stav.
    const totalTimer = setTimeout(() => {
      req.destroy(new Error('total_timeout'));
    }, input.totalTimeoutMs);

    req.setTimeout(input.connectTimeoutMs, () => {
      req.destroy(new Error('connect_timeout'));
    });

    req.on('error', (err) => {
      clearTimeout(totalTimer);
      reject(err);
    });

    req.write(input.body);
    req.end();
  });
}
