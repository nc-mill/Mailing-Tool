import { describe, expect, it } from 'vitest';
import { parseDocument } from './html';
import { collectLogoCandidates, sanitizeSvg, scoreLogo, selectLogo } from './logo';

describe('kandidáti na logo', () => {
  it('JSON-LD Organization.logo má nejvyšší prioritu', () => {
    const doc = parseDocument(
      '<script type="application/ld+json">{"@type":"Organization","logo":"/logo.png"}</script>',
    );
    expect(collectLogoCandidates(doc, 'https://kolo-shop.cz/')[0]).toMatchObject({
      url: 'https://kolo-shop.cz/logo.png',
      priority: 1,
    });
  });

  it('og:logo je priorita 2', () => {
    const doc = parseDocument('<meta property="og:logo" content="https://kolo-shop.cz/og.png">');
    expect(collectLogoCandidates(doc, 'https://kolo-shop.cz/')[0]).toMatchObject({ priority: 2 });
  });

  it('obrázek v header nebo nav s logem v atributech je priorita 3', () => {
    const doc = parseDocument('<header><img src="/brand-logo.svg" alt="Logo"></header>');
    expect(collectLogoCandidates(doc, 'https://kolo-shop.cz/')[0]).toMatchObject({
      priority: 3,
      url: 'https://kolo-shop.cz/brand-logo.svg',
    });
  });

  it('apple-touch-icon a icon jsou priority 4 a 5, favicon.ico je 6', () => {
    const doc = parseDocument(
      '<link rel="apple-touch-icon" sizes="180x180" href="/a.png"><link rel="icon" sizes="32x32" href="/i.png">',
    );
    const candidates = collectLogoCandidates(doc, 'https://kolo-shop.cz/');
    expect(candidates.map((c) => c.priority)).toEqual([4, 5, 6]);
    expect(candidates.at(-1)?.url).toBe('https://kolo-shop.cz/favicon.ico');
  });

  it('nejvýše osm kandidátů, protože víc jich nestahujeme', () => {
    const links = Array.from({ length: 20 }, (_, i) => `<link rel="icon" href="/i${i}.png">`).join(
      '',
    );
    expect(collectLogoCandidates(parseDocument(links), 'https://kolo-shop.cz/').length).toBe(8);
  });
});

describe('skóre loga', () => {
  const base = { priority: 3, format: 'png' as const, hasAlpha: false };

  it('široké logo dostane bonus', () => {
    expect(scoreLogo({ ...base, width: 400, height: 100 })).toBeGreaterThan(
      scoreLogo({ ...base, width: 150, height: 40 }),
    );
  });

  it('velmi malý obrázek dostane srážku', () => {
    expect(scoreLogo({ ...base, width: 32, height: 32 })).toBeLessThan(100);
  });

  it('alfa kanál je bonus 15, protože jde na barevné pozadí', () => {
    expect(scoreLogo({ ...base, width: 300, height: 100, hasAlpha: true })).toBe(
      scoreLogo({ ...base, width: 300, height: 100, hasAlpha: false }) + 15,
    );
  });

  it('priorita 1 a 2 dostane bonus 20', () => {
    expect(scoreLogo({ ...base, priority: 1, width: 300, height: 100 })).toBe(
      scoreLogo({ ...base, priority: 3, width: 300, height: 100 }) + 20,
    );
  });

  it('ico dostane srážku 30', () => {
    expect(scoreLogo({ ...base, format: 'ico', width: 300, height: 100 })).toBe(
      scoreLogo({ ...base, format: 'png', width: 300, height: 100 }) - 30,
    );
  });

  it('extrémní poměr stran dostane srážku', () => {
    expect(scoreLogo({ ...base, width: 1200, height: 30 })).toBeLessThan(
      scoreLogo({ ...base, width: 400, height: 120 }),
    );
  });
});

describe('výběr loga', () => {
  it('T19: když žádný kandidát nemá skóre nad 60, logo se neuloží a přibude varování', () => {
    const result = selectLogo([
      {
        url: 'https://kolo-shop.cz/favicon.ico',
        priority: 6,
        format: 'ico',
        width: 16,
        height: 16,
        hasAlpha: false,
      },
    ]);
    expect(result).toEqual({ logo: null, warnings: ['logo_not_found'] });
  });

  it('vyhrává nejvyšší skóre', () => {
    const result = selectLogo([
      {
        url: 'https://kolo-shop.cz/a.png',
        priority: 5,
        format: 'png',
        width: 200,
        height: 60,
        hasAlpha: false,
      },
      {
        url: 'https://kolo-shop.cz/b.png',
        priority: 1,
        format: 'png',
        width: 400,
        height: 120,
        hasAlpha: true,
      },
    ]);
    expect(result.logo?.url).toBe('https://kolo-shop.cz/b.png');
    expect(result.warnings).toEqual([]);
  });
});

describe('T18: sanitizace SVG', () => {
  it('odmítne dokument s ENTITY, tedy XXE', () => {
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>')).toEqual(
      {
        ok: false,
        reason: 'entity_in_prolog',
      },
    );
  });

  it('odstraní skript', () => {
    const result = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toContain('script');
    expect(result.svg).toContain('path');
  });

  it('odstraní foreignObject, image a odkaz', () => {
    const result = sanitizeSvg('<svg><foreignObject/><image href="x"/><a href="x"/><rect/></svg>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const tag of ['foreignObject', 'image', '<a']) expect(result.svg).not.toContain(tag);
    expect(result.svg).toContain('rect');
  });

  it('odstraní atributy začínající na on', () => {
    const result = sanitizeSvg('<svg><rect onload="alert(1)" fill="#fff"/></svg>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toContain('onload');
    expect(result.svg).toContain('fill');
  });

  it('odstraní use s externím odkazem', () => {
    const result = sanitizeSvg('<svg><use href="https://zlo.example/x.svg#a"/><rect/></svg>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toContain('zlo.example');
  });

  it('ponechá povolené elementy', () => {
    const result = sanitizeSvg(
      '<svg><g><path d="M0 0"/><circle r="1"/><linearGradient><stop offset="0"/></linearGradient></g></svg>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const tag of ['g', 'path', 'circle', 'linearGradient', 'stop']) {
      expect(result.svg.toLowerCase()).toContain(tag.toLowerCase());
    }
  });
});
