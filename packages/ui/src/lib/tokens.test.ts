// @vitest-environment node
// Test čte soubor z disku, DOM k tomu nepotřebuje. V jsdom prostředí je
// import.meta.url adresa http://, ze které fileURLToPath cestu neodvodí.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/;

/** Vytáhne blok deklarací podle značky v komentáři, například `@tokens light`. */
function block(name: string): Record<string, string> {
  const marker = `@tokens ${name} `;
  const start = css.indexOf(marker);
  expect(start, `blok ${name} v tokens.css chybí`).toBeGreaterThan(-1);
  const close = css.indexOf('}', start);
  const body = css.slice(start, close);
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const match = line.match(DECLARATION);
    if (match?.[1] && match[2]) out[match[1]] = match[2].trim();
  }
  return out;
}

const light = block('light');
const dark = block('dark');
const darkMedia = block('dark-media');

/** Hodnota tokenu, která v bloku musí existovat. Test bez ní nemá co měřit. */
function tokenValue(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`token ${name} v bloku chybí`);
  return value;
}

describe('tokens.css', () => {
  it('definuje tokeny povinné podle části 1, kapitoly 5.1', () => {
    for (const token of [
      '--color-surface',
      '--color-surface-muted',
      '--color-border',
      '--color-text',
      '--color-text-muted',
      '--color-primary',
      '--color-danger',
      '--color-warning',
      '--color-success',
    ]) {
      expect(light, `chybí ${token}`).toHaveProperty(token);
    }
  });

  /**
   * STUPNICE VRSTEV MÁ TŘI PATRA A JEJICH POŘADÍ JE PRAVIDLO, NE NÁHODA.
   *
   * Naměřená vada: `--z-dialog` bylo 40, tedy POD lištou (50), takže za
   * otevřeným dialogem zůstávalo svítit logo, přepínač projektů i jméno
   * uživatele, zatímco zbytek obrazovky ztmavl. Odečteno z pixelů: lišta
   * držela #faf7ee, obsah pod ní #868279.
   *
   * Čtyřicítku mělo `--z-dialog` navíc SPOLEČNOU s `--z-sidebar` a boční menu
   * bylo překryté jen pořadím v DOM. Test proto trvá i na ostré nerovnosti:
   * o vrstvení má rozhodovat číslo, ne pořadí v kódu.
   */
  it('vrstvy jdou po sobě: skořápka, dialog, vyjížděcí vrstva', () => {
    const layer = (name: string) => Number(tokenValue(light, name));
    expect(layer('--z-sidebar')).toBeLessThan(layer('--z-topbar'));
    expect(layer('--z-topbar')).toBeLessThan(layer('--z-dialog'));
    expect(layer('--z-dialog')).toBeLessThan(layer('--z-flyout'));
    expect(layer('--z-toast')).toBeLessThan(layer('--z-sidebar'));
  });

  it('světlý a tmavý režim mají stejnou množinu barevných tokenů', () => {
    const colors = (source: Record<string, string>) =>
      Object.keys(source)
        .filter((key) => key.startsWith('--color-'))
        .sort();
    expect(colors(dark)).toEqual(colors(light));
  });

  it('oba zápisy tmavého režimu jsou shodné', () => {
    expect(darkMedia).toEqual(dark);
  });

  it('žádná hodnota není literál z Tailwind palety', () => {
    expect(css).not.toContain('theme(colors.');
  });

  const pairs: Array<[string, string, number]> = [
    ['--color-text', '--color-surface', 4.5],
    ['--color-text', '--color-surface-muted', 4.5],
    ['--color-text-muted', '--color-surface', 4.5],
    ['--color-text-muted', '--color-surface-muted', 4.5],
    ['--color-accent-text', '--color-surface', 4.5],
    ['--color-accent-text', '--color-accent-surface', 4.5],
    ['--color-primary-foreground', '--color-primary', 4.5],
    ['--color-danger-text', '--color-surface', 4.5],
    ['--color-danger-text', '--color-danger-surface', 4.5],
    ['--color-danger-foreground', '--color-danger', 4.5],
    ['--color-warning-text', '--color-surface', 4.5],
    ['--color-warning-text', '--color-warning-surface', 4.5],
    ['--color-success-text', '--color-surface', 4.5],
    ['--color-success-text', '--color-success-surface', 4.5],
    ['--color-border-strong', '--color-surface', 3],
    ['--color-focus-ring', '--color-surface', 3],
    ['--color-focus-ring', '--color-surface-muted', 3],
  ];

  for (const [mode, tokens] of [
    ['světlý', light],
    ['tmavý', dark],
  ] as const) {
    describe(`${mode} režim`, () => {
      for (const [foreground, background, minimum] of pairs) {
        it(`${foreground} na ${background} má aspoň ${minimum}:1`, () => {
          expect(
            contrastRatio(tokenValue(tokens, foreground), tokenValue(tokens, background)),
          ).toBeGreaterThanOrEqual(minimum);
        });
      }
    });
  }
});
