import http from 'node:http';
import type { Check } from '@mlain/core/health';
import { buildReadiness } from '@mlain/core/health';

export interface HealthServerOptions {
  readonly port: number;
  readonly checks: readonly Check[];
}

/**
 * Rozhodnutí D11: node:http stačí, tři cesty bez routingu nepotřebují framework.
 * Port se v compose souboru nepublikuje ven.
 */
export function startHealthServer(options: HealthServerOptions): http.Server {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }
    if (request.url === '/readyz') {
      void buildReadiness(options.checks).then((result) => {
        response.writeHead(result.httpStatus, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: result.status, checks: result.checks }));
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  server.listen(options.port);
  return server;
}
