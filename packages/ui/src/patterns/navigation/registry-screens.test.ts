import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAVIGATION } from './registry';

/**
 * Brána proti hotové obrazovce, na kterou se nedá proklikat.
 *
 * Položky navigace mají příznak `mvp0`, kterým se skrývají, dokud jejich
 * obrazovka neexistuje. To dává smysl. Nikdo ho ale nepřepnul zpátky ve chvíli,
 * kdy obrazovka vznikla, takže v aplikaci byly hotové a fungující obrazovky
 * dostupné jedině přímou adresou:
 *
 *   /settings/sending  (odesílací účty a domény)
 *   /settings/backups  (zálohy)
 *
 * Nic nespadlo, nic se nerozbilo, jen tam ta položka nebyla. Uživatel nemá jak
 * zjistit, že obrazovka existuje, a tvůrce nemá jak zjistit, že ji nikdo nevidí.
 * Odhaleno až průchodem zlatou cestou, která na obrazovku odesílání potřebovala.
 *
 * Táž vada byla dřív u nastavení AI, jen s jinou příčinou (neexistující
 * oprávnění). Je to opakovaný tvar, proto brána.
 */

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) throw new Error('Kořen workspace se nepodařilo najít.');
    dir = parent;
  }
}

/** Všechny položky včetně vnořených, zploštěné do jednoho seznamu. */
function flatten(items: readonly unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    out.push(item);
    if (Array.isArray(item['children'])) out.push(...flatten(item['children']));
  }
  return out;
}

describe('navigace nesmí skrývat hotové obrazovky', () => {
  it('každá skrytá položka opravdu nemá obrazovku', async () => {
    const root = repoRoot();
    const skryte = flatten(NAVIGATION).filter(
      (item) => item['mvp0'] === false && typeof item['path'] === 'string',
    );

    const zbytecneSkryte: string[] = [];
    for (const item of skryte) {
      const path = item['path'] as string;
      const soubor = join(root, 'apps/web/src/app/[locale]/w/[workspaceSlug]', path, 'page.tsx');
      if (existsSync(soubor)) zbytecneSkryte.push(`${String(item['id'])} -> ${path}`);
    }

    expect(
      zbytecneSkryte,
      'Obrazovka existuje, ale položka navigace je skrytá příznakem `mvp0: false`, ' +
        'takže se na ni nedá proklikat. Přepněte na `mvp0: true`.\n\n' +
        zbytecneSkryte.join('\n'),
    ).toEqual([]);
  });

  /**
   * Opačný směr téže vady, a horší z těch dvou.
   *
   * Skrytá položka nikoho neoklame, jen ji uživatel nevidí. Zobrazená položka
   * bez obrazovky ale **slibuje funkci, kterou produkt nemá**, a klik na ni
   * skončí čtyřistačtyřkou. Naměřeno v prohlížeči na čtyřech položkách naráz:
   *
   *   Kontrola oslovení  /greeting-queue          404 (obrazovka je jinde)
   *   Statistiky         /statistics              404 (obrazovka je jinde)
   *   Formuláře          /forms                   404 (obrazovka neexistuje)
   *   Naplánované        /campaigns/scheduled     404 (obrazovka neexistuje)
   *
   * Dvě z nich měly obrazovku na jiné cestě, dvě ji neměly vůbec. Brána proto
   * nutí rozhodnout: buď cestu srovnat, nebo položku schovat.
   */
  it('žádná zobrazená položka nevede na neexistující obrazovku', () => {
    const root = repoRoot();
    const zobrazene = flatten(NAVIGATION).filter(
      (item) =>
        item['mvp0'] === true &&
        item['reservedFor'] === undefined &&
        typeof item['path'] === 'string' &&
        (item['path'] as string) !== '',
    );

    const mrtve: string[] = [];
    for (const item of zobrazene) {
      const path = item['path'] as string;
      const soubor = join(root, 'apps/web/src/app/[locale]/w/[workspaceSlug]', path, 'page.tsx');
      if (!existsSync(soubor)) mrtve.push(`${String(item['id'])} -> ${path}`);
    }

    expect(
      mrtve,
      'Položka navigace je vidět, ale obrazovka pro ni neexistuje, takže klik ' +
        'skončí na 404. Buď cestu srovnejte na skutečnou obrazovku, nebo ' +
        'položku schovejte příznakem `mvp0: false`.\n\n' +
        mrtve.join('\n'),
    ).toEqual([]);
  });

  /**
   * Druhá polovina téže vady: položka odkazuje na oprávnění, které neexistuje.
   * Kontrola pak nikdy neprojde a položka se nezobrazí nikomu, aniž by cokoli
   * selhalo. Přesně tak zmizelo nastavení AI, které mělo `ai:read` místo
   * `ai:configure`.
   */
  it('každá položka vyžaduje oprávnění, které existuje', async () => {
    const root = repoRoot();
    const source = await readFile(join(root, 'packages/core/src/identity/permissions.ts'), 'utf8');

    const neznama: string[] = [];
    for (const item of flatten(NAVIGATION)) {
      const perm = item['permission'];
      if (typeof perm !== 'string') continue;
      if (!source.includes(`'${perm}'`)) neznama.push(`${String(item['id'])} -> ${perm}`);
    }

    expect(
      neznama,
      'Položka navigace vyžaduje oprávnění, které v systému neexistuje. Kontrola ' +
        'nikdy neprojde a položka se nezobrazí NIKOMU, aniž by cokoli selhalo.\n\n' +
        neznama.join('\n'),
    ).toEqual([]);
  });
});
