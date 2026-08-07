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
import type { ValidationProfile } from '@mlain/emails/document/profile';
import { type FieldCatalog, pickLabel, toMergePath, usableFields } from '../../model/field-catalog';
import {
  DEFAULT_PAGE_SURFACE,
  surfaceHasContact,
  surfaceNonContactVariables,
  type PageSurface,
} from '../../model/page-surface';
import { Braces } from '../icons';
import { useView } from '../view/view-state';
import { useFieldLabel } from './field-labels';
import { GREETING_PATH, greetingGuidanceFor } from './greeting-guidance';
import { usePageSurface } from './page-surface-context';
import { useTemplateProfile } from './template-profile';

/**
 * SYSTÉMOVÉ ODKAZY, tedy adresy, které do zprávy dosadí až odesílač.
 *
 * Seznam NENÍ výběr z toho, co je v Liquidu povolené (`ALLOWED_ROOTS` má i
 * `campaign` a `workspace`), ale z toho, co někdo doopravdy NAPLNÍ. Ověřeno
 * čtením plnicích míst:
 *
 *  - `unsubscribe_url`, `preferences_url`, `webview_url` plní `worker.go`
 *    (`app/worker.go`, kroky 1 a 4) z podepsaného tokenu.
 *  - `data.confirm_url` plní aplikace při odesílání potvrzovacího e-mailu
 *    seznamu (`contacts/lists/subscription-emails.ts`).
 *
 * `one_click_unsubscribe_url` v nabídce SCHVÁLNĚ NENÍ. Odesílač do něj dosazuje
 * tutéž hodnotu jako do `unsubscribe_url` (`worker.go`, dva řádky pod sebou)
 * a existuje kvůli hlavičce `List-Unsubscribe-Post`, kterou skládá odesílač sám.
 * V těle zprávy je to tedy dvojník s názvem, který slibuje něco jiného.
 *
 * PROFIL ROZHODUJE, KTERÝ ODKAZ SE NABÍDNE, a není to kosmetika:
 *
 *  - V transakčním profilu (e-maily seznamu, transakční šablony) odesílač
 *    `preferences_url` ani `webview_url` NEDODÁVÁ vůbec a `unsubscribe_url`
 *    přepisuje prázdným řetězcem. Odhlašovací odkaz v e-mailu seznamu navíc
 *    blokuje uložení (`list-email-guards.ts`), takže by ho nabídka nabízela
 *    rovnou do chyby.
 *  - V kampaňovém profilu je zase zakázaný kořen `data`
 *    (`rootsForTemplateKind`), takže `data.confirm_url` by v kampani skončil
 *    blokující chybou `liquid_unknown_root` (naměřeno `checkSemantics`).
 *
 * Nabídnout obojí všude tedy nejde ani jako ústupek: jedna z těch dvou skupin
 * by v daném druhu šablony byla vždycky vadná.
 */
const SYSTEM_LINKS: Array<{ tag: string; profile: ValidationProfile }> = [
  { tag: 'webview_url', profile: 'campaign' },
  { tag: 'unsubscribe_url', profile: 'campaign' },
  { tag: 'preferences_url', profile: 'campaign' },
  { tag: 'data.confirm_url', profile: 'transactional' },
];

/**
 * Systémové odkazy, které mají v daném druhu šablony smysl. Exportováno kvůli testu.
 *
 * Profil `page` nedostane ANI JEDEN, a plyne to z dat, ne z výjimky: veřejná
 * stránka není zpráva, takže do ní odesílač nic nedosazuje. Odhlašovací odkaz
 * má vlastní stránku, potvrzovací odkaz patří do potvrzovacího e-mailu.
 */
export function systemLinksFor(profile: ValidationProfile): string[] {
  return SYSTEM_LINKS.filter((link) => link.profile === profile).map((link) => link.tag);
}

/**
 * Personalizace, kterou paletka nabídne na VEŘEJNÉ STRÁNCE, kromě polí kontaktu.
 *
 * Seznam se BERE z `variablesForSurface`, tedy z téže tabulky, podle které
 * validace stránku posoudí. Kdyby si ho paletka držela vlastní, nabídla by
 * dřív nebo později údaj, který uložení vzápětí odmítne.
 *
 * Pole kontaktu tu nejsou schválně: ta se berou z katalogu polí projektu,
 * protože jsou v něm i vlastní atributy, které tabulka povrchů nevyjmenovává
 * (kořen `contact` se posuzuje celý). Rozhoduje se tedy jen o tom, JESTLI se
 * skupiny kontaktu vůbec ukážou, ne co v nich bude.
 */
export function pageVariablesFor(surface: PageSurface): string[] {
  return surfaceNonContactVariables(surface);
}

/**
 * Údaje o kampani a projektu. NEJSOU to odkazy a stojí pod nimi.
 *
 * POZOR, ZDĚDĚNÝ STAV: obojí je dnes v odeslané kampani PRÁZDNÉ. `buildRenderData`
 * (`core/src/campaigns/audience/render-data.ts`) snapshotuje jen cesty pod
 * `contact.`, takže se `campaign.name` ani `workspace.name` do `messages.render_data`
 * nedostanou a render s `strictVariables: false` z nich udělá prázdný řetězec.
 * Nabídka to nezpůsobila a nevyřeší; oprava patří do materializace kampaně.
 */
const SYSTEM_FIELDS = ['campaign.name', 'workspace.name'];

/** `unsubscribe_url` na `unsubscribeUrl`, `data.confirm_url` na `dataConfirmUrl`. */
function messageKey(tag: string): string {
  return tag.replace(/[._](\w)/g, (_, character: string) => character.toUpperCase());
}

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
  const profile = useTemplateProfile();
  const fieldLabel = useFieldLabel();
  /*
   * PALETKA ZNÁ POVRCH, ne jen druh šablony. Je to jádro pravidla z oddílu 4.3
   * plánu: na děkovací stránce se kontakt NESMÍ ani nabídnout, protože se na ni
   * chodí přesměrováním bez tokenu a o návštěvníkovi tam nevíme nic.
   *
   * Chybějící povrch u profilu `page` se bere jako nejužší (`form_thanks`).
   * Kdyby znamenal „nabídni všechno", nezapojená propa by se projevila až
   * u návštěvníka prázdným místem uprostřed věty, což je přesně ta vada, kvůli
   * které pravidlo vzniklo.
   */
  const surface = usePageSurface();
  const pageSurface: PageSurface | null =
    profile === 'page' ? (surface ?? DEFAULT_PAGE_SURFACE) : null;
  const contactAvailable = pageSurface === null || surfaceHasContact(pageSurface);
  // Skutečná věta, kterou oslovení vydá. Skládá ji `buildGreeting`, tedy tentýž
  // kód, jaký ji složí při odeslání, viz `greetingExample` ve `view-state`.
  const { greetingExample } = useView();
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
            {greetingField === undefined || !contactAvailable ? null : (
              <CommandGroup heading={t('personalization.groupGreeting')}>
                <CommandItem
                  value={pickLabel(greetingField.label, locale)}
                  onSelect={() => insert(toMergePath(greetingField.path))}
                >
                  <span className="flex flex-col">
                    <span>{pickLabel(greetingField.label, locale)}</span>
                    {/* UKÁZKA VĚTY, NE JEN NÁZEV POLE. Nález z provozu:
                        „Když tam vložím Oslovení, tak vlastně nevím, jak vypadá.
                        Bude to Dobrý den Honzo? Nebo Krásný den Honzo?"
                        U jména si výsledek domyslí každý, u oslovení ne: je to
                        hotová věta ze zdvořilostní formule a pátého pádu, a jak
                        zní, rozhoduje nastavení projektu, ne název pole.

                        Věta se BERE, nevymýšlí: `greetingExample` je buď
                        skutečné oslovení zvoleného kontaktu, nebo vzorové,
                        které skládá `buildGreeting`. */}
                    {greetingExample === null ? null : (
                      <span
                        data-testid="greeting-example"
                        className="text-meta text-text-muted italic"
                      >
                        {t('personalization.greetingExample', { example: greetingExample })}
                      </span>
                    )}
                    <span className="text-meta text-text-muted">
                      {t('personalization.greetingHint')}
                    </span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {/*
              SKUPINY KONTAKTU SE NA POVRCHU BEZ TOKENU VŮBEC NEVYKRESLÍ.
              Nestačí je nechat a chybu ohlásit až při validaci: uživatel, který
              údaj v nabídce vidí, ho použije, a teprve pak se dozví, že tam
              nepatří. Nabídnout ho a vzápětí odmítnout je horší než nenabídnout.
            */}
            {!contactAvailable ? null : (
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
            )}
            {!contactAvailable ? null : (
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
            )}
            {/*
              ÚDAJE STRÁNKY MÍSTO SYSTÉMOVÝCH ODKAZŮ.
              Na veřejné stránce nejsou žádné odesílačem dosazované adresy, zato
              tam jsou hodnoty, které dodá aplikace při vykreslení (název
              formuláře, název seznamu, odesílatel). Seznam je z téže tabulky,
              podle které se stránka validuje, takže se nabídka a uložení
              nemůžou rozejít.
            */}
            {pageSurface === null ? null : (
              <CommandGroup heading={t('personalization.groupPage')}>
                {pageVariablesFor(pageSurface).map((tag) => (
                  <CommandItem key={tag} value={fieldLabel(tag)} onSelect={() => insert(tag)}>
                    {fieldLabel(tag)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* Systémové odkazy mají nápovědu POD popiskem, stejně jako Oslovení.
                Popisek říká, co odkaz udělá; nápověda říká, kde funguje, což je
                u těchhle adres to jediné, co se dá splést. */}
            {pageSurface !== null ? null : (
              <CommandGroup heading={t('personalization.groupSystem')}>
                {systemLinksFor(profile).map((tag) => {
                  const key = messageKey(tag);
                  const label = t(`field.${key}`);
                  return (
                    <CommandItem
                      key={tag}
                      value={label}
                      // Bez synonym nenajde hledání „odkaz" ani „URL" nic, co
                      // nemá to slovo v popisku. Naměřeno na `defaultFilter`
                      // z `cmdk`: „Zobrazení v prohlížeči" mělo na dotaz „odkaz"
                      // skóre 0, takže položka ze seznamu zmizela a vypadalo to,
                      // že odkaz na zobrazení v prohlížeči v nabídce chybí.
                      keywords={t(`personalization.systemSearch.${key}`)
                        .split(',')
                        .map((word) => word.trim())
                        .filter((word) => word !== '')}
                      onSelect={() => insert(tag)}
                    >
                      <span className="flex flex-col">
                        <span>{label}</span>
                        <span className="text-meta text-text-muted">
                          {t(`personalization.systemHint.${key}`)}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
                {SYSTEM_FIELDS.map((tag) => {
                  const label = t(`field.${messageKey(tag)}`);
                  return (
                    <CommandItem key={tag} value={label} onSelect={() => insert(tag)}>
                      {label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
