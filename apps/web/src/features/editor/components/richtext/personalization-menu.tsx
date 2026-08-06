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
import { Tooltip, TooltipProvider } from '@mlain/ui/components/tooltip';
import type { Editor } from '@tiptap/react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type FieldCatalog, pickLabel, toMergePath, usableFields } from '../../model/field-catalog';
import { Braces } from '../icons';
import { GREETING_PATH, greetingGuidanceFor } from './greeting-guidance';

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
  // Pole „Oslovení" z katalogu. Když ho projekt nemá (starý katalog, prázdná
  // nabídka v testu), skupina se prostě nevykreslí a nic se nerozbije.
  const greetingField = fields.find((field) => toMergePath(field.path) === GREETING_PATH);

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
      {/*
        Tlačítko je IKONOVÉ, stejně velké jako B, I, U.
        Text „Vložit personalizaci" lištu roztahoval a lámal do čtyř řádků,
        protože lišta visí nad blokem a její šířku omezuje šířka bloku.

        Jméno se tím ale NEZTRÁCÍ: nese ho `aria-label` (hlasové ovládání,
        čtečka) a bublina po najetí (myš). Ikona bez jména by byla krok zpět.

        Ikona je `Braces` z vlastní sady, ne `lucide-react`: ta v `apps/web`
        dostupná není, je to závislost `packages/ui` (viz hlavička `icons.tsx`).
        Tvar cesty je z Lucide, takže je to táž ikona, jen jiným kanálem.
      */}
      <TooltipProvider>
        <Tooltip content={t('richtext.insertPersonalization')}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-[var(--size-control-xs)] min-h-[var(--size-control-xs)] px-0"
              data-testid="insert-personalization"
              aria-label={t('richtext.insertPersonalization')}
            >
              <Braces aria-hidden className="icon-sm" />
            </Button>
          </PopoverTrigger>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t('personalization.search')} />
          <CommandList>
            <CommandEmpty>{t('personalization.empty')}</CommandEmpty>
            {/* Oslovení má vlastní skupinu a stojí NAD ostatními poli kontaktu.
                Důvod je vada z provozu: uživatel hledal „5. pád", našel
                „Křestní jméno v 5. pádu" (surovinu), složil z něj s literálem
                „Dobrý den," vlastní větu a v náhledu dostal 1. pád. Hotovou větu
                vydává jedině `contact.greeting`, a to musí být vidět dřív, než
                si uživatel začne oslovení skládat sám. */}
            {greetingField === undefined ? null : (
              <CommandGroup heading={t('personalization.groupGreeting')}>
                <CommandItem
                  value={pickLabel(greetingField.label, locale)}
                  onSelect={() => insert(toMergePath(greetingField.path))}
                >
                  <span className="flex flex-col">
                    <span>{pickLabel(greetingField.label, locale)}</span>
                    <span className="text-meta text-text-muted">
                      {t('personalization.greetingHint')}
                    </span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={t('personalization.groupContact')}>
              {fields
                .filter((field) => !field.path.startsWith('attr.'))
                .filter((field) => toMergePath(field.path) !== GREETING_PATH)
                .map((field) => (
                  <CommandItem
                    key={field.path}
                    value={pickLabel(field.label, locale)}
                    onSelect={() => insert(toMergePath(field.path))}
                  >
                    <span className="flex flex-col">
                      <span>{pickLabel(field.label, locale)}</span>
                      {/* Nápověda „Jen jméno. Oslovení z něj neskládejte." dává smysl
                          jen tam, kde je co neskládat. V projektu, který oslovení
                          neřeší, není v nabídce žádná hotová věta, na kterou by šlo
                          odkázat, takže by ta věta jen radila vyhnout se něčemu,
                          co uživatel nikde nevidí. Stav se pozná z KATALOGU, ne
                          z další propy: `greetingField` je `undefined` právě tehdy,
                          když je oslovení vypnuté (pole je označené `deleted`). */}
                      {greetingField !== undefined &&
                      greetingGuidanceFor(toMergePath(field.path)) === 'nameFragment' ? (
                        <span className="text-meta text-text-muted">
                          {t('personalization.fragmentHint')}
                        </span>
                      ) : null}
                    </span>
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
