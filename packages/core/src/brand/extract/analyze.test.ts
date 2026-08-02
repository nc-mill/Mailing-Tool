import { describe, expect, it } from 'vitest';
import { analyzePage } from './analyze';
import { FALLBACK_PALETTE } from './palette';

const page = (body: string, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('analýza stažené stránky', () => {
  it('barvy z externího stylopisu se použijí', () => {
    const result = analyzePage({
      html: page('<p>Ahoj</p>', '<link rel="stylesheet" href="/styl.css">'),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [
        {
          url: 'https://kolo-shop.cz/styl.css',
          body: Buffer.from(':root{--brand-primary:#c41e3a}'),
        },
      ],
    });
    expect(result.palette.primary).toBe('#c41e3a');
    expect(result.palette.source.primary).toBe('css-var');
  });

  it('theme-color přebije barvu nalezenou jen často', () => {
    const result = analyzePage({
      html: page('<p>x</p>', '<meta name="theme-color" content="#0057b8">'),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [],
    });
    expect(result.palette.primary).toBe('#0057b8');
    expect(result.palette.source.primary).toBe('meta');
  });

  it('web bez barev dostane výchozí paletu a varování', () => {
    const result = analyzePage({
      html: page('<p>Nic</p>'),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [],
    });
    expect(result.palette.primary).toBe(FALLBACK_PALETTE.primary);
    expect(result.warnings).toContain('colors_not_found');
    expect(result.warnings).toContain('fonts_not_found');
  });

  it('písmo a zaoblení se odvodí z CSS', () => {
    const result = analyzePage({
      html: page(
        '<p>x</p>',
        '<style>body{font-family:Georgia, serif}.btn{border-radius:8px}</style>',
      ),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [],
    });
    expect(result.typography.bodyStack).toBe('georgia');
    expect(result.typography.radius).toBe(8);
  });

  it('kandidáti na logo se posbírají a výběr se odloží s varováním', () => {
    const result = analyzePage({
      html: page('<header><img src="/logo.png" alt="Logo"></header>'),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [],
    });
    expect(result.logoCandidates.map((c) => c.url)).toContain('https://kolo-shop.cz/logo.png');
    expect(result.warnings).toContain('logo_not_measured');
  });

  it('viditelný text se vrátí bez skriptů, ať má odvození tónu z čeho vycházet', () => {
    const result = analyzePage({
      html: page('<h1>Kolo Shop</h1><script>alert("zlo")</script>'),
      finalUrl: 'https://kolo-shop.cz/',
      assets: [],
    });
    expect(result.visibleText).toBe('Kolo Shop');
  });
});
