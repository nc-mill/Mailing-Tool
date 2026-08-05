/**
 * Dosažitelnost měřicí domény zvenčí.
 *
 * DOPLNĚK NAD RÁMEC PLÁNU, a je to oprava vady, kterou plán nepopsal.
 *
 * `TRACKING_DOMAIN` je adresa, kterou aplikace zapéká do odeslaných e-mailů
 * (pixel, prokliky) a ze které se stahuje měřicí skript. Na vývojové instalaci
 * je to `http://localhost:3200`. Cokoli, co si tahá server třetí strany, se
 * tam nedostane: Gmail stahuje obrázky přes vlastní proxy, takže z Gmailu
 * NEDORAZÍ ANI JEDNO OTEVŘENÍ. Webové události jsou na tom líp, protože je
 * posílá prohlížeč návštěvníka, ale na cizím webu bude `localhost` stejně
 * nedostupný.
 *
 * Aplikace to do teď mlčky přecházela a uživatel z prázdného reportu usoudil,
 * že je měření rozbité. Tenhle modul dá aplikaci možnost to říct nahlas.
 */

export type DomainReach =
  /** Veřejné jméno, měření může fungovat odkudkoli. */
  | { kind: 'public'; host: string }
  /** Smyčka na tomhle počítači. Zvenčí nedosažitelné pro nikoho. */
  | { kind: 'loopback'; host: string }
  /** Adresa z privátního rozsahu nebo jméno bez tečky, tedy jen z vnitřní sítě. */
  | { kind: 'private'; host: string }
  /** Adresa vůbec není platná. */
  | { kind: 'invalid'; host: string };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.test', '.invalid', '.example'];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 169.254.0.0/16 je link-local, tedy taky jen vnitřní.
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Posoudí, jestli je měřicí doména dosažitelná z internetu.
 *
 * Neptá se sítě, jen se dívá na tvar jména. Je to schválně: obrazovka
 * nastavení nesmí při vykreslení čekat na DNS, a hlavně nás nezajímá,
 * jestli adresa odpovídá NÁM, ale jestli na ni dosáhne cizí prohlížeč.
 */
export function classifyTrackingDomain(rawUrl: string): DomainReach {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    // Bez schématu to není adresa, ale možná to je holé jméno hostitele.
    const candidate = rawUrl.trim().toLowerCase();
    if (candidate === '' || /[\s/:]/.test(candidate)) return { kind: 'invalid', host: rawUrl };
    host = candidate;
  }
  if (host === '') return { kind: 'invalid', host: rawUrl };

  if (LOOPBACK_HOSTS.has(host)) return { kind: 'loopback', host };
  if (isPrivateIpv4(host)) return { kind: 'private', host };
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { kind: 'private', host };
  // Jméno bez tečky je jméno z vnitřní sítě, veřejná doména tečku má vždycky.
  if (!host.includes('.')) return { kind: 'private', host };

  return { kind: 'public', host };
}

/** Zkratka pro rozhraní: má se uživateli ukázat varování? */
export function isTrackingDomainUnreachable(rawUrl: string): boolean {
  return classifyTrackingDomain(rawUrl).kind !== 'public';
}
