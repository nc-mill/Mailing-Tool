import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { verifySmtp, classifySmtpError } from '../smtp/verify';

let server: Server | undefined;
afterEach(() => server?.close());

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ PÁDEM. Plán psal `socket.write(script[step++])` bez
 * kontroly. U scénáře s prázdným scénářem (test časového stropu) je `script[0]`
 * `undefined` a `socket.write(undefined)` skončí `ERR_INVALID_ARG_TYPE` uvnitř
 * obsluhy spojení, tedy neodchycenou výjimkou, která shodí celý běh testů.
 * Zápis se proto dělá jen tehdy, když scénář další odpověď má.
 */
function fakeSmtp(script: string[]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      let step = 0;
      if (step < script.length) socket.write(script[step++]!);
      socket.on('data', () => {
        if (step < script.length) socket.write(script[step++]!);
      });
    });
    server.listen(0, () => resolve((server!.address() as { port: number }).port));
  });
}

describe('test SMTP pripojeni', () => {
  it('uspesny dialog vrati ok', async () => {
    const port = await fakeSmtp([
      '220 ok\r\n',
      '250-x\r\n250 AUTH LOGIN PLAIN\r\n',
      '235 ok\r\n',
      '250 ok\r\n',
      '221 bye\r\n',
    ]);
    const r = await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
      allowPrivateAddress: true,
    });
    expect(r.ok).toBe(true);
  });

  it('535 mapuje na provider_smtp_auth_failed', async () => {
    const port = await fakeSmtp(['220 ok\r\n', '250 AUTH LOGIN PLAIN\r\n', '535 bad\r\n']);
    const r = await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
      allowPrivateAddress: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_auth_failed');
  });

  it('neplatne uvitani mapuje na provider_smtp_greeting_invalid', async () => {
    const port = await fakeSmtp(['500 nope\r\n']);
    const r = await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
      allowPrivateAddress: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_greeting_invalid');
  });

  it('neznamy host mapuje na provider_smtp_host_unknown', async () => {
    const r = await verifySmtp({
      host: 'nope.invalid',
      port: 587,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
      allowPrivateAddress: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_host_unknown');
  });

  it('timeout 10 s mapuje na provider_smtp_timeout', async () => {
    const port = await fakeSmtp([]);
    const r = await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 200,
      allowPrivateAddress: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_timeout');
  });

  it.each([
    ['ECONNREFUSED', 'provider_smtp_connection_refused'],
    ['ENOTFOUND', 'provider_smtp_host_unknown'],
    ['CERT_HAS_EXPIRED', 'provider_smtp_tls_invalid'],
  ] as const)('kod %s mapuje na %s', (code, expected) => {
    expect(classifySmtpError({ code })).toBe(expected);
  });

  it('test neposila testovaci mail, jen NOOP a QUIT', async () => {
    const seen: string[] = [];
    const port = await new Promise<number>((resolve) => {
      server = createServer((socket) => {
        socket.write('220 ok\r\n');
        socket.on('data', (b) => {
          seen.push(b.toString());
          socket.write(seen.length === 1 ? '250 AUTH LOGIN PLAIN\r\n' : '250 ok\r\n');
        });
      });
      server.listen(0, () => resolve((server!.address() as { port: number }).port));
    });
    await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
      allowPrivateAddress: true,
    });
    expect(seen.join('')).not.toMatch(/MAIL FROM|RCPT TO|DATA/);
  });

  /**
   * DOPLNĚK PROTI PLÁNU. Plán ochranu proti SSRF u testu připojení neměl vůbec, přitom
   * host zadává uživatel. Bez tohohle testu by výchozí chování zůstalo neověřené
   * a stačilo by ho omylem obrátit.
   */
  it('bez vyslovneho povoleni se na neverejnou adresu vubec nepripojuje', async () => {
    const port = await fakeSmtp(['220 ok\r\n', '250 AUTH LOGIN PLAIN\r\n', '235 ok\r\n']);
    const r = await verifySmtp({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      encryption: 'none',
      timeoutMs: 2000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_connection_refused');
  });
});
