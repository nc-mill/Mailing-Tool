import robotsParser from 'robots-parser';
import {
  safeFetch,
  type SafeFetchDeps,
  type SafeFetchLimits,
  type SafeFetchPolicy,
} from './safe-fetch';

export const ROBOTS_MAX_BYTES = 100 * 1024;
export const ROBOTS_TIMEOUT_MS = 3000;

export function USER_AGENT(appUrl: string): string {
  return `MlainMailerBrandBot/1.0 (+${appUrl}/about/bot)`;
}

export function robotsUrlFor(target: string): string {
  const url = new URL(target);
  const port =
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
      ? ''
      : url.port;
  const authority = port === '' ? url.hostname : `${url.hostname}:${port}`;
  return `${url.protocol}//${authority}/robots.txt`;
}

export type RobotsFetchResult =
  { ok: true; status: number; body: Buffer } | { ok: false; code: string };

export type RobotsOptions = {
  respectRobots: boolean;
  appUrl: string;
  fetchRobots: (url: string) => Promise<RobotsFetchResult>;
};

export type RobotsVerdict =
  | { allowed: true }
  | { allowed: false; code: 'brand_robots_disallowed' | 'brand_robots_unavailable' };

/**
 * robots.txt respektujeme ve výchozím stavu.
 *
 * 4xx a neexistující soubor jsou povolující, což je standardní chování.
 * 5xx u robots.txt znamená „nevím" a slušný crawler v takové situaci
 * nepokračuje, takže se extrakce odmítne.
 */
export async function checkRobots(target: string, options: RobotsOptions): Promise<RobotsVerdict> {
  if (!options.respectRobots) return { allowed: true };

  const robotsUrl = robotsUrlFor(target);
  const response = await options.fetchRobots(robotsUrl);

  // Nedostupný robots.txt se považuje za povolující. Jinak by dočasný výpadek
  // sítě u nás vypadal jako zákaz na cizím webu.
  if (!response.ok) return { allowed: true };

  if (response.status >= 500) return { allowed: false, code: 'brand_robots_unavailable' };
  if (response.status >= 400) return { allowed: true };

  const agent = USER_AGENT(options.appUrl);
  const parsed = robotsParser(
    robotsUrl,
    response.body.subarray(0, ROBOTS_MAX_BYTES).toString('utf8'),
  );
  const allowed = parsed.isAllowed(target, agent) ?? parsed.isAllowed(target, '*') ?? true;

  return allowed ? { allowed: true } : { allowed: false, code: 'brand_robots_disallowed' };
}

/**
 * Podoba pro kompoziční kořen: robots.txt se stahuje toutéž jedinou cestou ven
 * jako všechno ostatní, tedy přes `safeFetch`. Bez tohohle obalu by `checkRobots`
 * neměl v produkci čím stahovat a musel by si volající sestavovat přenos sám.
 */
export async function checkRobotsAllowed(
  target: string,
  wiring: {
    limits: SafeFetchLimits;
    policy: SafeFetchPolicy;
    deps: SafeFetchDeps;
    appUrl: string;
    respectRobots?: boolean;
  },
): Promise<RobotsVerdict> {
  return checkRobots(target, {
    respectRobots: wiring.respectRobots ?? true,
    appUrl: wiring.appUrl,
    fetchRobots: async (url) => {
      const result = await safeFetch(url, wiring.limits, wiring.policy, wiring.deps);
      return result.ok
        ? { ok: true, status: result.status, body: result.body }
        : { ok: false, code: result.code };
    },
  });
}
