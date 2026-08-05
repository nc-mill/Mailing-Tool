'use client';

import { ChevronDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/dropdown-menu';
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
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-text hover:bg-surface-muted"
      >
        <span
          data-testid="workspace-accent"
          aria-hidden="true"
          className="inline-block h-4 w-1.5 rounded-full"
          style={{ backgroundColor: workspaceAccent(currentId) }}
        />
        {current ? labels.current(current.name) : labels.switcher}
        {current ? <span className="sr-only">{labels.switcher}</span> : null}
        <ChevronDown aria-hidden className="size-4 text-text-muted" />
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
              <Plus aria-hidden className="size-4" />
              {labels.create}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
