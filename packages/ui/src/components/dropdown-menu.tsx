'use client';

import { DropdownMenu as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({
  children,
  align = 'start',
  className,
}: {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        align={align}
        sideOffset={6}
        className={cn(
          // `--z-flyout`, ne `--z-dialog`: nabídka se otevírá i z horní lišty
          // (přepínač projektů, nabídka účtu) a ta má vyšší vrstvu, takže se
          // nabídce schovávalo horních pár pixelů i s rámečkem. Viz stupnice
          // vrstev v `tokens.css`.
          'z-[var(--z-flyout)] min-w-56 rounded-[var(--radius-surface)] border border-border',
          'bg-surface-overlay p-1 text-sm text-text shadow-lg',
          className,
        )}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Radix.Item
      onSelect={() => onSelect?.()}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-3',
        'data-[highlighted]:bg-surface-muted',
        tone === 'danger' ? 'text-danger-text' : 'text-text',
      )}
    >
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="my-1 h-px bg-border" />;
}

/**
 * Skupina položek pod jedním nadpisem.
 *
 * PROČ TO VZNIKLO: nabídka, ve které stojí „Brno" a o dva řádky níž zase „Brno",
 * jednou pro přidání a jednou pro odebrání, je past. Nadpis nad každou skupinou
 * a oddělovač mezi nimi jsou to jediné, co ty dvě položky odliší DŘÍV, než se
 * na ně klikne.
 *
 * NADPIS SI KRESLÍ SKUPINA SAMA, z jediného `label`. Kdyby si ho volající vkládal
 * zvlášť, může se rozejít text, který je vidět, s tím, co dostane čtečka; takhle
 * je to jedna hodnota na obou místech. `Radix.Label` navíc klávesnice přeskočí,
 * takže se z nadpisu nikdy nestane zdánlivá akce.
 */
export function DropdownMenuGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Radix.Group aria-label={label}>
      <Radix.Label className="px-3 py-2 text-xs font-medium text-text-muted">{label}</Radix.Label>
      {children}
    </Radix.Group>
  );
}
