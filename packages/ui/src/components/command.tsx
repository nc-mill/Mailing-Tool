'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { cn } from '../lib/cn';
import { passwordManagerOptOut } from '../lib/password-manager';

/**
 * Obal nad `cmdk`. API knihovny ven z tohohle souboru neuniká, protože
 * `cmdk` má poslední vydání starší než rok a platí pro něj pravidlo
 * vlastního rozhraní z 13.2 části 6.
 */
export const Command: typeof CommandPrimitive = CommandPrimitive;

export function CommandInput({ placeholder }: { placeholder: string }) {
  return (
    <CommandPrimitive.Input
      placeholder={placeholder}
      // Do paletky se hledá, nikdy nepřihlašuje. Bez těchhle značek nad polem
      // vyskočí nabídka uložených hesel, zakryje první položky seznamu a nejde
      // zavřít, protože kliknutí mimo ni zavře celou paletku. Proč zrovna tyhle
      // atributy a proč jich je víc, vysvětluje `lib/password-manager.ts`.
      // `type="text"` a `autoComplete="off"` si `cmdk` na tomhle poli nastavuje
      // samo a propy přepsat nejdou, tady je proto nenajdeš.
      {...passwordManagerOptOut}
      className="min-h-11 w-full border-b border-border bg-transparent px-4 text-sm text-text outline-none placeholder:text-text-muted"
    />
  );
}

export function CommandList({ children }: { children: React.ReactNode }) {
  return (
    <CommandPrimitive.List className="max-h-80 overflow-auto p-2">{children}</CommandPrimitive.List>
  );
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-text-muted">
      {children}
    </CommandPrimitive.Empty>
  );
}

export function CommandGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-text-muted',
      )}
    >
      {children}
    </CommandPrimitive.Group>
  );
}

/**
 * `keywords` jsou DALŠÍ slova, na která má hledání zabrat, kromě `value`.
 *
 * Výchozí filtr `cmdk` porovnává hledaný text jen s `value`, a to fuzzy podle
 * pořadí písmen. Položka „Zobrazení v prohlížeči" tak na dotaz „odkaz" nebo
 * „URL" dostane skóre 0 a ze seznamu zmizí, i když je to právě ona, kterou
 * uživatel hledá. Naměřeno na `defaultFilter` z `cmdk@1.1.1`.
 *
 * Synonyma proto NEPATŘÍ do `value`: `value` je i identita položky pro výběr
 * a klávesnici, kdežto tohle je jen slovník pro hledání.
 */
export function CommandItem({
  value,
  keywords,
  onSelect,
  children,
}: {
  value: string;
  keywords?: string[];
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      // Rozprostření, ne `keywords={keywords}`: při `exactOptionalPropertyTypes`
      // není `undefined` totéž co vynechaný klíč a `cmdk` slibuje jen ten druhý.
      {...(keywords ? { keywords } : {})}
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-text data-[selected=true]:bg-surface-muted"
    >
      {children}
    </CommandPrimitive.Item>
  );
}
