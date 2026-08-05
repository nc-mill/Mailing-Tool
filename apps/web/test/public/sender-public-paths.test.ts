// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BRÁNA MEZI DVĚMA JAZYKY: každá veřejná adresa, kterou skládá odesílač, musí mít ve
 * webu obsluhu.
 *
 * PROČ TENHLE TEST EXISTUJE. Odkaz „Zobrazit v prohlížeči" vedl v KAŽDÉM odeslaném
 * e-mailu na 404. Odesílač v Go adresu `/v/{token}` skládal
 * (`apps/sender/internal/token/urls.go`), web pro ni žádnou cestu neměl, a nic to
 * nehlídalo, protože každá strana je v jiném jazyce i v jiném balíčku. Typová kontrola
 * takovou díru najít nemůže: mezi Go a TypeScriptem žádná není.
 *
 * PROČ SE ČTOU OBĚ STRANY A NE VÝČET V TESTU. Výčet by byl třetí místo, na které se
 * musí nezapomenout, a zapomnělo by se na něj z týchž důvodů jako na to druhé. Tenhle
 * test si adresy VYTÁHNE ze zdrojáku odesílače a cesty si SESBÍRÁ ze stromu tras webu,
 * takže spadne i tehdy, když někdo přidá čtvrtou takovou adresu a druhou stranu neudělá.
 * Cenou je vazba na tvar `u.base() + "/x/"` v `urls.go`; když se ten tvar změní, test
 * to ohlásí tím, že nenajde žádnou adresu (poslední kontrola níž).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const URLS_GO = join(HERE, '..', '..', '..', 'sender', 'internal', 'token', 'urls.go');
const APP_DIR = join(HERE, '..', '..', 'src', 'app');

/** Adresy, které odesílač skládá z TRACKING_DOMAIN. Tvar `u.base() + "/něco/"`. */
function senderPaths(): string[] {
  const source = readFileSync(URLS_GO, 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/u\.base\(\)\s*\+\s*"([^"]+)"/g)) {
    found.add(match[1]!);
  }
  return [...found].sort();
}

/** Vzor jedné trasy, například `['t', '[[...path]]']` pro `app/t/[[...path]]/route.ts`. */
function routePatterns(): string[][] {
  const out: string[][] = [];
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Skupiny `(public)` a paralelní sloty `@slot` do adresy nevstupují.
        walk(
          full,
          entry.startsWith('(') || entry.startsWith('@') ? segments : [...segments, entry],
        );
      } else if (entry === 'route.ts' || entry === 'route.tsx') {
        out.push(segments);
      }
    }
  };
  walk(APP_DIR, []);
  return out;
}

/** Sedne adresa na vzor trasy? Napodobuje pravidla App Routeru pro dynamické segmenty. */
function matches(pattern: readonly string[], segments: readonly string[]): boolean {
  if (pattern.length === 0) return segments.length === 0;
  const [head, ...rest] = pattern;
  if (head!.startsWith('[[...')) {
    // Nepovinný zachytávač bere zbytek adresy včetně prázdna, ale musí být poslední.
    return rest.length === 0;
  }
  if (head!.startsWith('[...')) return rest.length === 0 && segments.length >= 1;
  if (segments.length === 0) return false;
  const isDynamic = head!.startsWith('[');
  if (!isDynamic && head !== segments[0]) return false;
  return matches(rest, segments.slice(1));
}

describe('veřejné adresy odesílače mají obsluhu ve webu', () => {
  const paths = senderPaths();
  const patterns = routePatterns();

  it.each(paths)('%s obsluhuje nějaká trasa', (path) => {
    // Adresa v e-mailu je prefix plus token; u pevných adres (`/u/test`) prefix sám.
    const url = path.endsWith('/') ? `${path}TOKEN` : path;
    const segments = url.split('/').filter((s) => s !== '');
    const hit = patterns.some((pattern) => matches(pattern, segments));
    expect(
      hit,
      `odesílač skládá ${url}, ale apps/web/src/app pro to nemá route.ts. ` +
        'Buď doplň obsluhu, nebo tu adresu v apps/sender/internal/token/urls.go přestaň vyrábět.',
    ).toBe(true);
  });

  it('ze zdrojáku odesílače se vůbec nějaké adresy vytáhly', () => {
    // Bez téhle kontroly by se test po přepsání `urls.go` změnil v nulu testů
    // a tvářil by se zeleně, i kdyby neobsluhovaná zůstala každá adresa.
    expect(paths.length).toBeGreaterThanOrEqual(5);
    expect(paths).toContain('/u/');
    expect(paths).toContain('/p/');
    expect(paths).toContain('/v/');
  });
});
