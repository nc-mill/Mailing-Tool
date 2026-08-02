import { buildConnector as undiciBuildConnector } from 'undici';
import { classifyAddress, type ClassifyOptions } from './address';

export type PinnedConnectorOptions = ClassifyOptions & {
  /** Ověřená adresa z kroku rozlišení jmen. Spojení jde sem, ne na jméno. */
  pinnedIp: string;
  /** Původní hostname kvůli SNI a ověření certifikátu. */
  servername: string;
  connectTimeoutMs?: number;
  buildConnector?: typeof undiciBuildConnector;
};

type ConnectCallback = (error: unknown, socket: unknown) => void;
type ConnectOptions = { hostname: string; protocol: string; port: number | string };

/**
 * Poslední pojistka proti DNS rebindingu. Zabere i tehdy, kdyby cokoliv
 * v předchozích krocích selhalo, protože kontroluje SKUTEČNÝ STAV SPOJENÍ,
 * ne předpoklad.
 *
 * Mezi kontrolou adresy a navázáním spojení může DNS server odpovědět jinak
 * (odpověď s TTL 0: první dotaz veřejná adresa, druhý 169.254.169.254).
 * Obrana je proto dvojitá: spojení jde na ověřenou IP a po navázání se
 * skutečný protějšek ověří znovu.
 */
export function createPinnedConnector(options: PinnedConnectorOptions) {
  const build = options.buildConnector ?? undiciBuildConnector;
  const inner = build({
    timeout: options.connectTimeoutMs ?? 3000,
    rejectUnauthorized: true,
    autoSelectFamily: false,
  }) as unknown as (opts: unknown, callback: ConnectCallback) => void;

  return function connect(opts: ConnectOptions, callback: ConnectCallback): void {
    inner(
      {
        ...opts,
        // Spojení se navazuje na ověřenou IP adresu.
        hostname: options.pinnedIp,
        // SNI a ověření certifikátu proti původnímu hostname.
        servername: options.servername,
        rejectUnauthorized: true,
        autoSelectFamily: false,
      },
      (error: unknown, socket: unknown) => {
        if (error !== null && error !== undefined) {
          callback(error, null);
          return;
        }
        const remoteAddress = (socket as { remoteAddress?: string } | null)?.remoteAddress;
        if (typeof remoteAddress === 'string') {
          const verdict = classifyAddress(remoteAddress, options);
          if (!verdict.allowed) {
            (socket as { destroy: () => void }).destroy();
            callback(
              Object.assign(new Error('blocked peer'), { code: 'brand_blocked_address' }),
              null,
            );
            return;
          }
        }
        callback(null, socket);
      },
    );
  };
}
