'use client';

import { Button } from '@mlain/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@mlain/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import type { Editor } from '@tiptap/react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type FieldCatalog, pickLabel, toMergePath, usableFields } from '../../model/field-catalog';
import { Braces } from '../icons';

const SYSTEM_TAGS = [
  'unsubscribe_url',
  'preferences_url',
  'webview_url',
  'campaign.name',
  'workspace.name',
];

/**
 * Vkládá se z nabídky, nikdy psaním. Nabídka je hledatelná a dělí se na systémová a vlastní pole.
 *
 * ODCHYLKA OD PLÁNU: skupiny jsou obalené `CommandList` a položky mají `value`.
 * Obal P05 vystavuje `CommandList` a `CommandItem` s povinným `value`; bez seznamu
 * `cmdk` nefiltruje a bez hodnoty nemá podle čeho hledat.
 */
export function PersonalizationMenu({
  editor,
  fieldCatalog,
}: {
  editor: Editor;
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations('editor');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const fields = usableFields(fieldCatalog);

  const insert = (expr: string) => {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'personalization',
        attrs: { expr, fallback: null, dateFormat: null },
      })
      .run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('richtext.insertPersonalization')}>
          <Braces aria-hidden className="size-4" />
          <span className="ml-1 hidden sm:inline">{t('richtext.insertPersonalization')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t('personalization.search')} />
          <CommandList>
            <CommandEmpty>{t('personalization.empty')}</CommandEmpty>
            <CommandGroup heading={t('personalization.groupContact')}>
              {fields
                .filter((field) => !field.path.startsWith('attr.'))
                .map((field) => (
                  <CommandItem
                    key={field.path}
                    value={pickLabel(field.label, locale)}
                    onSelect={() => insert(toMergePath(field.path))}
                  >
                    {pickLabel(field.label, locale)}
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandGroup heading={t('personalization.groupCustom')}>
              {fields
                .filter((field) => field.path.startsWith('attr.'))
                .map((field) => (
                  <CommandItem
                    key={field.path}
                    value={pickLabel(field.label, locale)}
                    onSelect={() => insert(toMergePath(field.path))}
                  >
                    {pickLabel(field.label, locale)}
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandGroup heading={t('personalization.groupSystem')}>
              {SYSTEM_TAGS.map((tag) => {
                const label = t(
                  `field.${tag.replace(/[._](\w)/g, (_, character: string) => character.toUpperCase())}`,
                );
                return (
                  <CommandItem key={tag} value={label} onSelect={() => insert(tag)}>
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
