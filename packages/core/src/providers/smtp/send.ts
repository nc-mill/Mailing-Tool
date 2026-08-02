import { lookup } from 'node:dns/promises';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { isBlockedAddress } from '../../net/ssrf';
import { classifySmtpError, type SmtpErrorCode } from './verify';

/**
 * Odeslání JEDNÉ zprávy přes SMTP účet projektu.
 *
 * PROČ TO TU JE, KDYŽ „skutečné odesílání dělá sender v Go". Sender čte tabulku
 * `messages`, a ta má `contact_id NOT NULL` a náklad vázaný na zkompilovanou
 * kampaň. Systémový e-mail žádný z toho nemá: obnovu hesla si vyžádá člověk bez
 * projektu, pozvánku dostane adresa bez kontaktu a potvrzení odesílací adresy jde
 * na schránku, která v nástroji nemá účet. Protlačit je outboxem by znamenalo
 * zakládat falešné kontakty a falešné kampaně.
 *
 * Zároveň to NENÍ druhý odesílací stroj: nemá frontu, opakování, throttling ani
 * měření doručitelnosti. Je to nejkratší cesta, jak dostat pět provozních zpráv
 * ven, a všechno ostatní zůstává senderu.
 *
 * `verifySmtp` z vedlejšího souboru se nedá použít: končí u NOOP a QUIT, tedy
 * přesně před tím, co je tady potřeba.
 */
export type SmtpSendResult =
  | { ok: true; response: string }
  | { ok: false; code: SmtpErrorCode | 'provider_smtp_rejected'; detail: string };

export type SmtpSendInput = {
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: 'starttls' | 'tls' | 'none';
  timeoutMs: number;
  /** Viz `verifySmtp`: výchozí hodnota je `false`, tedy chráněno proti SSRF. */
  allowPrivateAddress?: boolean;
  from: string;
  to: string;
  /** Hotové řádky hlaviček a těla. Skládá je `buildSystemMailMime`. */
  message: string;
};

export async function sendSmtp(input: SmtpSendInput): Promise<SmtpSendResult> {
  let socket: Socket | undefined;
  try {
    if (!input.allowPrivateAddress && (await resolvesToBlockedAddress(input.host))) {
      return {
        ok: false,
        code: 'provider_smtp_connection_refused',
        detail: 'Adresa serveru míří do neveřejného rozsahu.',
      };
    }

    socket = await open(input);
    const banner = await readReply(socket, input.timeoutMs);
    if (!banner.startsWith('220')) {
      return { ok: false, code: 'provider_smtp_greeting_invalid', detail: banner.trim() };
    }

    let ehlo = await command(socket, 'EHLO mlain.local', input.timeoutMs);
    if (input.encryption === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) {
        return { ok: false, code: 'provider_smtp_starttls_unsupported', detail: ehlo.trim() };
      }
      await command(socket, 'STARTTLS', input.timeoutMs);
      socket = upgrade(socket, input.host);
      ehlo = await command(socket, 'EHLO mlain.local', input.timeoutMs);
    }

    /**
     * Přihlášení se přeskakuje, když server žádné nenabízí. Poštovní past pro E2E
     * běží bez AUTH a `AUTH PLAIN` na ni vrátí 502; bez téhle větve by se přes ni
     * nedalo poslat nic a doručení by nešlo doložit.
     */
    if (/AUTH/i.test(ehlo) && input.username !== '') {
      const auth = Buffer.from(`\0${input.username}\0${input.password}`).toString('base64');
      const authReply = await command(socket, `AUTH PLAIN ${auth}`, input.timeoutMs);
      if (!authReply.startsWith('235')) {
        return { ok: false, code: 'provider_smtp_auth_failed', detail: authReply.trim() };
      }
    }

    const mailFrom = await command(socket, `MAIL FROM:<${input.from}>`, input.timeoutMs);
    if (!mailFrom.startsWith('250')) {
      return { ok: false, code: 'provider_smtp_rejected', detail: mailFrom.trim() };
    }
    const rcpt = await command(socket, `RCPT TO:<${input.to}>`, input.timeoutMs);
    if (!rcpt.startsWith('250')) {
      return { ok: false, code: 'provider_smtp_rejected', detail: rcpt.trim() };
    }
    const data = await command(socket, 'DATA', input.timeoutMs);
    if (!data.startsWith('354')) {
      return { ok: false, code: 'provider_smtp_rejected', detail: data.trim() };
    }

    // Tečkování je POVINNÉ, ne kosmetika: řádek se samotnou tečkou uprostřed těla
    // by zprávu ukončil dřív a zbytek by server přečetl jako SMTP příkazy.
    const body = input.message.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
    const accepted = await command(socket, `${body}\r\n.`, input.timeoutMs);
    if (!accepted.startsWith('250')) {
      return { ok: false, code: 'provider_smtp_rejected', detail: accepted.trim() };
    }

    await command(socket, 'QUIT', input.timeoutMs);
    return { ok: true, response: accepted.trim() };
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
 * ODCHYLKA PROTI `verify.ts`, VYNUCENÁ PROTOKOLEM. Tamní `readReply` vrací první
 * kus dat, který ze socketu vypadne. U `NOOP` to stačí, u `EHLO` a u konce těla ne:
 * odpověď je víceřádková (`250-STARTTLS`, `250-AUTH`, …, `250 SIZE`) a klidně přijde
 * ve dvou paketech. Čte se proto do řádku, který má na čtvrtém znaku mezeru, což je
 * podle RFC 5321 poslední řádek odpovědi. Bez toho zůstane zbytek odpovědi v bufferu
 * a přečte se jako odpověď na PŘÍŠTÍ příkaz, takže se protokol posune o jedna.
 */
function readReply(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('smtp_timeout'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    }
    function onData(chunk: Buffer): void {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter((l) => l !== '');
      const last = lines[lines.length - 1];
      if (last !== undefined && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    }
    function onError(e: Error): void {
      cleanup();
      reject(e);
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function command(socket: Socket, line: string, timeoutMs: number): Promise<string> {
  socket.write(`${line}\r\n`);
  return readReply(socket, timeoutMs);
}
