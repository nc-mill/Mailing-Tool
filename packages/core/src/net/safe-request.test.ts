import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { applyUnitEnv } from '../test-support/unit-env';
import { SsrfBlockedError, WEBHOOK_SSRF_POLICY } from './ssrf';
import { safeRequest, MAX_RESPONSE_BYTES } from './safe-request';

/**
 * Musí běžet PŘED prvním čtením `WEBHOOK_SSRF_POLICY`, ne až v `beforeAll`:
 * `allowPrivateNetworks` je getter nad `loadConfig()` a spread níž ho vyhodnotí
 * už při načtení modulu.
 */
applyUnitEnv();

let server: Server;
let port = 0;
/** Kolik požadavků server SKUTEČNĚ přijal. Bez toho by šlo "odmítnutí" jen tvrdit. */
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('prijato');
      return;
    }
    if (req.url === '/velke') {
      res.writeHead(200);
      res.end('x'.repeat(64 * 1024));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(307, { Location: 'http://169.254.169.254/' });
      res.end();
      return;
    }
    if (req.url === '/pomale') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('pozde');
      }, 3000);
      return;
    }
    res.writeHead(500);
    res.end('chyba');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Testovací server běží na loopbacku, takže se testuje s povolenými privátními rozsahy. */
const policy = { ...WEBHOOK_SSRF_POLICY, allowPrivateNetworks: true, allowHttp: true };

describe('safeRequest', () => {
  it('odešle tělo i hlavičky a vrátí odpověď', async () => {
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/ok`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ML-Attempt': '1' },
      body: '{"a":1}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('prijato');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('přesměrování NENÁSLEDUJE, vrátí 3xx jako výsledek', async () => {
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/redirect`,
      method: 'POST',
      headers: {},
      body: '{}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.status).toBe(307);
  });

  it('čte nejvýš 8 kB odpovědi, zbytek zahodí', async () => {
    expect(MAX_RESPONSE_BYTES).toBe(8 * 1024);
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/velke`,
      method: 'POST',
      headers: {},
      body: '{}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.body.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });

  it('celkový timeout ukončí spojení', async () => {
    await expect(
      safeRequest({
        url: `http://127.0.0.1:${port}/pomale`,
        method: 'POST',
        headers: {},
        body: '{}',
        policy,
        connectTimeoutMs: 500,
        totalTimeoutMs: 800,
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it('blokovaná adresa skončí SsrfBlockedError bez pokusu o spojení', async () => {
    await expect(
      safeRequest({
        url: 'https://169.254.169.254/hook',
        method: 'POST',
        headers: {},
        body: '{}',
        policy: WEBHOOK_SSRF_POLICY,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('kritérium 39: jméno, které se přeloží na privátní adresu, se zablokuje při doručení', async () => {
    await expect(
      safeRequest({
        url: 'https://localhost/hook',
        method: 'POST',
        headers: {},
        body: '{}',
        policy: WEBHOOK_SSRF_POLICY,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

/**
 * Doplněno nad rámec plánu. Předchozí dva testy tvrdí, že klient hodí chybu,
 * ale nedokazují, že se na privátní rozsah SKUTEČNĚ nesáhlo: chyba by mohla
 * přijít až po odeslání požadavku. Tady stojí na loopbacku živý server, který
 * si počítá požadavky, a měří se, že jeho čítač zůstane netknutý.
 */
describe('měřitelný důkaz: na privátní rozsah se nesáhne', () => {
  it('požadavek na běžící loopback server pod přísnou politikou server nikdy nezasáhne', async () => {
    // Rozehřátí: pod povolující politikou server odpoví, takže víme, že běží
    // a že by ho striktní pokus mohl trefit, kdyby ho ochrana nezastavila.
    const warmup = await safeRequest({
      url: `http://127.0.0.1:${port}/ok`,
      method: 'POST',
      headers: {},
      body: '{}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(warmup.status).toBe(200);

    const before = hits;
    const strict = { ...WEBHOOK_SSRF_POLICY, allowHttp: true };
    expect(strict.allowPrivateNetworks).toBe(false);

    // Literální adresa: zastaví se ve statické kontrole.
    await expect(
      safeRequest({
        url: `http://127.0.0.1:${port}/ok`,
        method: 'POST',
        headers: {},
        body: '{}',
        policy: strict,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    // Jméno, které se teprve při doručení přeloží na loopback. Statická
    // kontrola tady nepomůže, zabírá až ověření rozřešených adres.
    await expect(
      safeRequest({
        url: `http://localhost:${port}/ok`,
        method: 'POST',
        headers: {},
        body: '{}',
        policy: strict,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    expect(hits, 'server na loopbacku nesměl dostat ani jeden požadavek').toBe(before);
  });
});
