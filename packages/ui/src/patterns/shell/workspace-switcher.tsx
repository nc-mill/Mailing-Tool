'use client';

import { ChevronDown, Plus } from '../../icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/dropdown-menu';
import { cn } from '../../lib/cn';
import { workspaceAccent } from '../../lib/workspace-accent';

export type WorkspaceSummary = { id: string; slug: string; name: string };

/**
 * Přepínač projektů. Uživatel musí vždy vědět, ve kterém projektu je,
 * protože jinak pošle kampaň špatným lidem.
 *
 * Přepnutí vede **vždy na Přehled** nového projektu, nikdy na stejnou
 * stránku v cizím projektu: kampaň s tímhle id tam neexistuje.
 *
 * Založení dalšího projektu je POSLEDNÍ položkou téhle nabídky, oddělenou
 * čárou. Je to jediné místo v aplikaci, kde se projekty vypisují, takže je
 * to jediné místo, kde je uživatel bude hledat. Položka je nepovinná: kde se
 * zakládat nesmí, prostě nevznikne, a nabídka zůstane jen přepínačem.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  onSwitch,
  onCreate,
  labels,
}: {
  workspaces: WorkspaceSummary[];
  currentId: string;
  // `theme` tu bývalo, protože si barva projektu vybírala světlost podle motivu
  // v JavaScriptu. Server ale motiv prohlížeče nezná, takže vykreslil jinou
  // barvu než klient a React hlásil nesoulad hydratace, který sám neopraví.
  // Dnes vrací `workspaceAccent()` CSS proměnnou a světlost dopočítá motiv,
  // takže komponenta o motivu vědět nepotřebuje.
  onSwitch: (slug: string) => void;
  /** Bez téhle funkce se položka „Nový projekt" vůbec nevykreslí. */
  onCreate?: (() => void) | undefined;
  labels: { switcher: string; current: (name: string) => string; create?: string | undefined };
}) {
  const current = workspaces.find((workspace) => workspace.id === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // Název tlačítka musí obsahovat viditelný text, jinak hlasové ovládání
        // nenajde projekt, který uživatel čte na obrazovce (WCAG 2.5.3).
        // Popis akce se přidává skrytým textem, ne aria-label, který by
        // viditelný název přebil.
        aria-label={current ? undefined : labels.switcher}
        className={cn(
          'flex min-h-[var(--size-control-sm)] min-w-0 items-center gap-[var(--spacing-inline)]',
          'rounded-[var(--radius-control)] border border-border px-3 font-mono text-meta text-text',
          'hover:border-border-strong hover:bg-surface-muted',
        )}
      >
        {/* Barva projektu. V návrhu je to čtvereček u názvu projektu, protože
            projekt se pozná odsud: boční menu je tmavé v každém projektu
            stejně. Dřív byla barva proužkem na hraně menu, kde ji na tmavém
            podkladu skoro nebylo vidět. */}
        <span
          data-testid="workspace-accent"
          aria-hidden="true"
          className="inline-block size-2.5 rounded-xs"
          style={{ backgroundColor: workspaceAccent(currentId) }}
        />
        {/* Název se na úzkém displeji zkrátí třemi tečkami. Bez `min-w-0`
            a `truncate` roste tlačítko s délkou názvu projektu a odtlačí
            zbytek hlavičky za pravý okraj. */}
        <span className="min-w-0 truncate">
          {current ? labels.current(current.name) : labels.switcher}
        </span>
        {current ? <span className="sr-only">{labels.switcher}</span> : null}
        <ChevronDown aria-hidden className="icon-xs shrink-0 text-text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onSwitch(workspace.slug)}>
            <span
              aria-hidden
              className="inline-block h-4 w-1.5 rounded-full"
              style={{ backgroundColor: workspaceAccent(workspace.id) }}
            />
            {workspace.name}
          </DropdownMenuItem>
        ))}
        {onCreate && labels.create ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate}>
              <Plus aria-hidden className="icon-sm" />
              {labels.create}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
