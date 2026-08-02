import { describe, expect, it, vi } from 'vitest';
import { USER_AGENT, checkRobots, robotsUrlFor, type RobotsFetchResult } from './robots';

const fetcher = (result: RobotsFetchResult) => vi.fn(async () => result);

describe('adresa robots.txt', () => {
  it('sestaví se ze schématu, hostu a portu, nikdy z cesty', () => {
    expect(robotsUrlFor('https://kolo-shop.cz/uvod?a=1')).toBe('https://kolo-shop.cz/robots.txt');
    expect(robotsUrlFor('http://kolo-shop.cz:80/x')).toBe('http://kolo-shop.cz/robots.txt');
  });
});

describe('user agent', () => {
  it('je pojmenovaný a odkazuje na stránku o botovi', () => {
    expect(USER_AGENT('https://mailer.example')).toBe(
      'MlainMailerBrandBot/1.0 (+https://mailer.example/about/bot)',
    );
  });
});

describe('vyhodnocení robots.txt', () => {
  it('T15: Disallow / pro * zakáže stahování', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({
        ok: true,
        status: 200,
        body: Buffer.from('User-agent: *\nDisallow: /\n'),
      }),
    });
    expect(result).toEqual({ allowed: false, code: 'brand_robots_disallowed' });
  });

  it('pravidlo pro našeho agenta má přednost před hvězdičkou', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({
        ok: true,
        status: 200,
        body: Buffer.from(
          'User-agent: *\nDisallow: /\n\nUser-agent: MlainMailerBrandBot\nAllow: /\n',
        ),
      }),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('T16: 5xx u robots.txt extrakci odmítne', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({ ok: true, status: 503, body: Buffer.alloc(0) }),
    });
    expect(result).toEqual({ allowed: false, code: 'brand_robots_unavailable' });
  });

  it('404 se považuje za povolující', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({ ok: true, status: 404, body: Buffer.alloc(0) }),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('nedostupný robots.txt se také považuje za povolující', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({ ok: false, code: 'brand_fetch_failed' }),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('timeout u robots.txt extrakci neodmítne', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({ ok: false, code: 'brand_timeout' }),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('při vypnutém respektování se robots.txt vůbec nestahuje', async () => {
    const fetchRobots = fetcher({ ok: true, status: 200, body: Buffer.from('Disallow: /') });
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: false,
      appUrl: 'https://mailer.example',
      fetchRobots,
    });
    expect(result).toEqual({ allowed: true });
    expect(fetchRobots).not.toHaveBeenCalled();
  });

  it('Crawl-delay se ignoruje, stahujeme jednotky souborů jednorázově', async () => {
    const result = await checkRobots('https://kolo-shop.cz/', {
      respectRobots: true,
      appUrl: 'https://mailer.example',
      fetchRobots: fetcher({
        ok: true,
        status: 200,
        body: Buffer.from('User-agent: *\nCrawl-delay: 3600\nAllow: /\n'),
      }),
    });
    expect(result).toEqual({ allowed: true });
  });
});
