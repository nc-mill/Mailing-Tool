import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brána nad tím, že skořápka projektu montuje sdílené providery.
 *
 * `useToast` mimo `ToastProvider` a `Tooltip` mimo `TooltipProvider` vyhodí
 * výjimku. Chyba v klientské komponentě přitom neshodí tu komponentu, ale
 * **celý strom po nejbližší error boundary**, takže uživatel místo obrazovky
 * uvidí „Aplikace se neočekávaně zastavila":
 *
 *   ⨯ Error: useToast se smí volat jen uvnitř ToastProvider.
 *
 * Naměřeno na Přehledu, kde zapojení jednoho panelu shodilo i dlaždice, které
 * do té chvíle fungovaly. Není to tedy vada jedné komponenty, ale celé stránky.
 *
 * Dokud to skořápka nedělala, obcházely to domény vlastními `layout.tsx`
 * (kontakty, seznamy, štítky, zablokované adresy) a nakonec i komponenty.
 * Šest míst, každé s poznámkou „až je skořápka dostane, tenhle soubor zmizí".
 * Sedmá obrazovka spadla stejně.
 *
 * Jednotkové testy tuhle třídu vady nechytnou, protože si providery montují
 * samy. Měří komponentu, ne její zasazení.
 */

const SHELL = 'apps/web/src/app/[locale]/w/[workspaceSlug]/layout.tsx';

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) throw new Error('Kořen workspace se nepodařilo najít.');
    dir = parent;
  }
}

describe('skořápka projektu montuje sdílené providery', () => {
  it('má ToastProvider', async () => {
    const source = await readFile(join(repoRoot(), SHELL), 'utf8');

    expect(
      source,
      'Bez ToastProvider spadne každá obrazovka, která sáhne na `useToast`, ' +
        'a spadne celá, ne jen ta komponenta.',
    ).toContain('<ToastProvider');
  });

  it('má TooltipProvider', async () => {
    const source = await readFile(join(repoRoot(), SHELL), 'utf8');

    expect(
      source,
      'Bez TooltipProvider spadne každá obrazovka s tooltipem, a spadne celá.',
    ).toContain('<TooltipProvider');
  });

  it('providery obalují AppShell, ne naopak', async () => {
    const source = await readFile(join(repoRoot(), SHELL), 'utf8');

    // Kdyby byly uvnitř `AppShell`, nedosáhly by na topbar ani na boční menu,
    // takže by tooltip v navigaci spadl dál.
    expect(source.indexOf('<ToastProvider')).toBeLessThan(source.indexOf('<AppShell'));
    expect(source.indexOf('<TooltipProvider')).toBeLessThan(source.indexOf('<AppShell'));
  });
});
