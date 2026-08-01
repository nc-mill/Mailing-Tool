'use client';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/command';
import { Dialog, DialogTitle } from '../../components/dialog';

export type CommandEntry = { id: string; label: string; group: string; onSelect: () => void };

/**
 * Paleta příkazů `Ctrl/Cmd + K`. Skořápka dodává rám a klávesu,
 * obsah (kontakty, kampaně, šablony, akce) dodávají doménové plány
 * přes `entries`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  entries,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: CommandEntry[];
  labels: { title: string; placeholder: string; empty: string };
}) {
  const groups = [...new Set(entries.map((entry) => entry.group))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{labels.title}</DialogTitle>
      <Command label={labels.title} className="mt-3">
        <CommandInput placeholder={labels.placeholder} />
        <CommandList>
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {entries
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.label}
                    onSelect={() => {
                      onOpenChange(false);
                      entry.onSelect();
                    }}
                  >
                    {entry.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </Dialog>
  );
}
