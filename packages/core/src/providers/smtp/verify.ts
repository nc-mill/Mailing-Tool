import { lookup } from 'node:dns/promises';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { isBlockedAddress } from '../../net/ssrf';

export type SmtpErrorCode =
  | 'provider_smtp_host_unknown'
  | 'provider_smtp_connection_refused'
  | 'provider_smtp_tls_invalid'
  | 'provider_smtp_auth_failed'
  | 'provider_smtp_timeout'
  | 'provider_smtp_starttls_unsupported'
  | 'provider_smtp_greeting_invalid';

export type SmtpVerifyResult =
  { ok: true; banner: string } | { ok: false; code: SmtpErrorCode; detail: string };

export function classifySmtpError(err: { code?: string }): SmtpErrorCode {
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'provider_smtp_host_unknown';
    case 'ECONNREFUSED':
      return 'provider_smtp_connection_refused';
    case 'ETIMEDOUT':
      return 'provider_smtp_timeout';
    default:
      if ((err.code ?? '').startsWith('CERT_') || (err.code ?? '').includes('TLS')) {
        return 'provider_smtp_tls_invalid';
      }
      return 'provider_smtp_connection_refused';
  }
}

/**
 * Test otevre spojeni, provede STARTTLS nebo prime TLS, prihlasi se, posle NOOP a QUIT.
 * NEPOSILA testovaci mail, protoze uzivatel na to v tomhle kroku neceka.
 * Na to staci node:net a node:tls; nodemailer by pridal zhruba 600 kB zavislosti
 * kvuli jednomu tlacitku v nastaveni a skutecne odesilani stejne dela sender v Go.
 */
export async function verifySmtp(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: 'starttls' | 'tls' | 'none';
  timeoutMs: number;
  /**
   * DOPLNĚK PROTI PLÁNU. Host SMTP serveru zadává uživatel, takže je to plnohodnotný
   * SSRF vektor: `localhost`, `169.254.169.254` nebo jméno, které se na ně rozřeší.
   * Kontrola jde přes sdílený `isBlockedAddress` z `packages/core/src/net`, ne přes
   * vlastní seznam rozsahů; druhý seznam proti téže hrozbě je způsob, jak jeden
   * z nich zastará.
   *
   * Výchozí hodnota je `false`, tedy chráněno. Testy proti falešnému serveru na
   * `127.0.0.1` si výjimku musí vyžádat výslovně, aby ji nikdo nezapnul omylem.
   */
  allowPrivateAddress?: boolean;
}): Promise<SmtpVerifyResult> {
  let socket: Socket | undefined;
  try {
    if (!input.allowPrivateAddress) {
      const blocked = await resolvesToBlockedAddress(input.host);
      if (blocked) {
        return {
          ok: false,
          code: 'provider_smtp_connection_refused',
          detail: 'Adresa serveru míří do neveřejného rozsahu.',
        };
      }
    }
    socket = await open(input);
    const banner = await readReply(socket, input.timeoutMs);
    if (!banner.startsWith('220')) {
      return { ok: false, code: 'provider_smtp_greeting_invalid', detail: banner.trim() };
    }

    const ehlo = await command(socket, `EHLO mlain.local`, input.timeoutMs);
    if (input.encryption === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) {
        return { ok: false, code: 'provider_smtp_starttls_unsupported', detail: ehlo.trim() };
      }
      await command(socket, 'STARTTLS', input.timeoutMs);
      socket = upgrade(socket, input.host);
      await command(socket, `EHLO mlain.local`, input.timeoutMs);
    }

    const auth = Buffer.from(`\0${input.username}\0${input.password}`).toString('base64');
    const authReply = await command(socket, `AUTH PLAIN ${auth}`, input.timeoutMs);
    if (!authReply.startsWith('235')) {
      return { ok: false, code: 'provider_smtp_auth_failed', detail: authReply.trim() };
    }

    await command(socket, 'NOOP', input.timeoutMs);
    await command(socket, 'QUIT', input.timeoutMs);
    return { ok: true, banner: banner.trim() };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.message === 'smtp_timeout') {
      return { ok: false, code: 'provider_smtp_timeout', detail: 'Server neodpověděl včas.' };
    }
    return { ok: false, code: classifySmtpError(e), detail: e.message ?? 'neznámá chyba' };
  } finally {
    socket?.destroy();
  }
}

/**
 * Nerozřešené jméno se NEPOVAŽUJE za zablokované: neznámý host je vlastní chyba
 * (`provider_smtp_host_unknown`) a hlásí se až z dialogu, aby uživatel dostal ten
 * důvod, který odpovídá skutečnosti.
 */
async function resolvesToBlockedAddress(host: string): Promise<boolean> {
  if (isBlockedAddress(host)) return true;
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.some((a) => isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

function open(input: {
  host: string;
  port: number;
  encryption: string;
  timeoutMs: number;
}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s =
      input.encryption === 'tls'
        ? tlsConnect({ host: input.host, port: input.port, servername: input.host })
        : netConnect({ host: input.host, port: input.port });
    s.setTimeout(input.timeoutMs);
    s.once('timeout', () => reject(new Error('smtp_timeout')));
    s.once('error', reject);
    s.once(input.encryption === 'tls' ? 'secureConnect' : 'connect', () => resolve(s as Socket));
  });
}

function upgrade(socket: Socket, host: string): Socket {
  return tlsConnect({ socket, servername: host }) as unknown as Socket;
}

/**
 * ODCHYLKA OD PLÁNU, JEN VE JMÉNU. Plán tuhle funkci pojmenoval `expect` a bral
 * očekávaný kód, který nikdy nepoužil. Jméno `expect` je v testovacím souboru zabrané
 * assertion knihovnou a mrtvý parametr svádí k tomu myslet si, že se kód kontroluje.
 * Chování je beze změny: přečte jednu odpověď, nebo spadne na časový strop.
 */
function readReply(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('smtp_timeout')), timeoutMs);
    socket.once('data', (b) => {
      clearTimeout(timer);
      resolve(b.toString());
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function command(socket: Socket, line: string, timeoutMs: number): Promise<string> {
  socket.write(`${line}\r\n`);
  return readReply(socket, timeoutMs);
}
