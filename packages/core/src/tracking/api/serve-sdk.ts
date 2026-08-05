/**
 * Servírování `ml.js`, viz plán P10 Task 46.
 *
 * SDK se distribuuje z `{TRACKING_DOMAIN}/e/ml.js`. Cesty jsou bez verze
 * v segmentu schválně: adresa `/t/o/…` je zapečená v odeslaných e-mailech
 * napořád a nesmí se nikdy měnit, takže ani sourozenecké cesty verzi nemají.
 */

export type SdkResponderDeps = {
  readBundle: () => string;
  /** Verze instance. Při upgradu se změní ETag a prohlížeče si stáhnou nový skript. */
  version: string;
};

export function createSdkResponder(deps: SdkResponderDeps): (request: Request) => Response {
  let cached: string | null = null;
  const etag = `W/"${deps.version}"`;

  return function serveSdk(request: Request): Response {
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    cached ??= deps.readBundle();
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        ETag: etag,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
