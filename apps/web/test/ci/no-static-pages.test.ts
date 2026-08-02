import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brána proti předrenderovaným stránkám. Ty se v tomhle produktu vylučují
 * s politikou obsahu, a to VŽDYCKY, ne jen shodou okolností.
 *
 * Proxy razítkuje inline skripty Nextu nonce, který vzniká PRO KAŽDÝ POŽADAVEK.
 * Předrenderované HTML vzniká při stavbě image, kdy žádný požadavek neexistuje,
 * takže do něj nonce nemá jak vstoupit. Za běhu prohlížeč dostane přísnou
 * politiku a skripty bez nonce, a zablokuje je:
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive 'script-src 'self' 'nonce-...''. The action has been blocked.
 *
 * Devětkrát na stránku. **React se nenamountuje a nefunguje nic**: stránka se
 * vykreslí ze serveru, vypadá hotově, a žádné tlačítko, formulář ani navigace
 * nereaguje. Postihlo to `/setup`, tedy úplně první obrazovku, kterou uživatel
 * po instalaci uvidí, a `/forgot-password`.
 *
 * Vada je čistě produkční: v dev režimu má politika `'unsafe-eval'` a nic se
 * neprojeví. Lokálně tedy všechno chodí a rozbité je jen to, co dostane
 * zákazník. Proto tahle brána.
 *
 * Kontroluje se ZDROJ, ne výstup `next build`. Tabulka tras je čitelnější,
 * ale existuje až po stavbě, tedy pozdě a jen tam, kde někdo stavěl. Tenhle
 * test běží s jednotkovými.
 */

/**
 * Stránka je dynamická, když to sama řekne (`force-dynamic`), nebo když si
 * vynutí čtení požadavku (`cookies()`, `headers()`, `searchParams`), případně
 * vypne cache (`revalidate = 0`). Cokoli z toho Nextu stačí.
 */
const DYNAMIC_MARKERS = [
  /export\s+const\s+dynamic\s*=\s*'force-dynamic'/,
  /**
   * Výslovné `force-static` se BERE jako splnění, přestože jde o opak.
   *
   * Vada, kvůli které tahle brána vznikla, nebyla statičnost, ale CHYBĚJÍCÍ
   * ROZHODNUTÍ: `/setup` neměl ani jedno a Next si vybral sám, což u stránky
   * s formulářem dopadlo špatně. Kdo napíše `force-static`, ví, co dělá; typicky
   * je to stránka bez jediného interaktivního prvku, třeba `/t/expired`, kde
   * zablokovaný bootstrap nemá co rozbít, protože není co hydratovat.
   *
   * Přísnější pravidlo (zakázat statické úplně) jsem zvážil a zahodil: nutilo
   * by vykreslovat na každý požadavek i stránky, které se nikdy nemění, a to
   * jen kvůli pravidlu, ne kvůli užitku.
   */
  /export\s+const\s+dynamic\s*=\s*'force-static'/,
  /export\s+const\s+revalidate\s*=\s*0\b/,
  /\bcookies\s*\(\s*\)/,
  /\bheaders\s*\(\s*\)/,
  /\bsearchParams\b/,
];

/**
 * `generateStaticParams` je opačný signál: říká Nextu, ať stránku pro dané
 * hodnoty předrenderuje. Tady je vždycky chyba, i kdyby stránka měla nějaký
 * dynamický znak vedle.
 */
const STATIC_MARKER = /export\s+(async\s+)?function\s+generateStaticParams/;

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) throw new Error('Kořen workspace se nepodařilo najít.');
    dir = parent;
  }
}

async function pageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...(await pageFiles(full)));
      continue;
    }
    if (entry.name === 'page.tsx') out.push(full);
  }
  return out;
}

describe('žádná stránka aplikace se nesmí předrenderovat', () => {
  it('každá page.tsx je dynamická', async () => {
    const root = repoRoot();
    const files = await pageFiles(join(root, 'apps/web/src/app'));
    expect(files.length, 'nenašly se žádné stránky, kontrola by byla naprázdno').toBeGreaterThan(
      20,
    );

    const staticke: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const jeDynamicka = DYNAMIC_MARKERS.some((re) => re.test(source));
      if (!jeDynamicka || STATIC_MARKER.test(source)) {
        staticke.push(relative(root, file));
      }
    }

    expect(
      staticke,
      'Stránka se předrenderuje při stavbě, takže do jejích inline skriptů nemůže vstoupit ' +
        'nonce, který proxy vyrábí pro každý požadavek. Prohlížeč je zablokuje, React se ' +
        'nenamountuje a na stránce nebude fungovat nic. Doplňte ' +
        "`export const dynamic = 'force-dynamic'`.\n\n" +
        staticke.join('\n'),
    ).toEqual([]);
  });

  it('detektor pozná stránku bez jediného dynamického znaku', () => {
    const staticka = ['export default function O() {', '  return <p>O nás</p>;', '}'].join('\n');

    expect(DYNAMIC_MARKERS.some((re) => re.test(staticka))).toBe(false);
  });

  it('výslovné force-static se bere jako vědomé rozhodnutí, ne jako nedopatření', () => {
    const staticka = [
      "export const dynamic = 'force-static';",
      'export default function Expired() {',
      '  return <p>Odkaz vypršel.</p>;',
      '}',
    ].join('\n');

    expect(DYNAMIC_MARKERS.some((re) => re.test(staticka))).toBe(true);
  });

  it('detektor pozná force-dynamic', () => {
    const dynamicka = [
      "export const dynamic = 'force-dynamic';",
      'export default function Setup() {',
      '  return <form />;',
      '}',
    ].join('\n');

    expect(DYNAMIC_MARKERS.some((re) => re.test(dynamicka))).toBe(true);
  });

  it('generateStaticParams je chyba i vedle dynamického znaku', () => {
    const smisena = [
      "export const dynamic = 'force-dynamic';",
      'export async function generateStaticParams() {',
      "  return [{ locale: 'cs' }];",
      '}',
    ].join('\n');

    expect(STATIC_MARKER.test(smisena)).toBe(true);
  });
});
