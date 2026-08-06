'use client';

import type { ThemeColorRole } from '@mlain/emails/document/types';
import { resolveTheme } from '@mlain/emails/theme/resolve';
import { CardTitle } from '@mlain/ui/components/card';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import { THEME_GROUPS } from '../../descriptors/theme';
import type { PropDescriptor } from '../../descriptors/types';
import { themeWithDefaults, type Theme } from '../../model/document-types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { PropField } from './prop-field';

/**
 * Úvodní řádek e-mailu (preheader). JEN U SAMOSTATNÉ ŠABLONY.
 *
 * Popisek sám o sobě lhal mlčením: pole vypadá jako obsah e-mailu, ale text
 * z něj se na plátně nikdy neobjeví, protože v těle e-mailu není. Emitter ho
 * dává do skrytého bloku na začátku `<body>` (`packages/emails/src/emitter/shell.tsx`)
 * a schránka ho ukáže v seznamu pošty vedle předmětu.
 *
 * U KAMPANĚ SE POLE NEUKAZUJE, protože je tam druhé v pořadí a nic nezmění:
 * kompilace bere `campaigns.preheader` z kroku 2 a po dokumentu sáhne, jen když
 * je krok 2 prázdný (`preheaderOf` v `packages/core/src/campaigns/compile-service.ts`).
 * Naměřeno na skutečné kampani: s vyplněným krokem 2 nese e-mail text z kroku 2
 * a text z editoru v něm není vůbec. Dvě pole na tutéž věc, z nichž jedno
 * skoro vždy prohraje, jsou horší než jedno.
 *
 * Samostatná šablona žádný krok 2 nemá, tam je tohle pole JEDINÁ cesta
 * k předhlavičce (`templates.routes.ts` bere `design.meta.previewText`),
 * takže tam zůstává i s nápovědou.
 *
 * Vede přes `PropField` se stejným deskriptorem jako ostatní pole panelu, aby
 * nápovědu kreslila TÁŽ bublina s ikonou, ne nový vzor. `kind: 'text'` vydá
 * `TextControl`, což je přesně `Input` s `maxLength`, jaký tu stál ručně.
 */
const PREVIEW_TEXT_PROP: PropDescriptor = {
  kind: 'text',
  key: 'previewText',
  label: 'meta.previewText',
  maxLength: 150,
  hint: 'hint.previewText',
};

/**
 * Společné podklady pro `PropField` v tomhle panelu. Panel motivu nemá jediné
 * pole odkazu, takže profil nic neovlivní. `campaign` je tu jako přísnější
 * z dvojice: kdyby sem někdy odkaz přibyl, bude se kontrolovat, ne propouštět.
 * Zástupný blok `$theme` je tu proto, že tahle pole nepatří žádnému bloku.
 */
const FIELD_BASE: Omit<ComponentProps<typeof PropField>, 'descriptor' | 'value' | 'onChange'> = {
  block: { id: '$theme', type: '$theme', props: {} },
  canWriteHtml: false,
  fieldCatalog: { fields: [], version: 'theme' },
  ports: null,
  templateKind: 'campaign',
};

/**
 * Pole panelu, jejichž klíč JE role motivu, ne cesta v motivu.
 *
 * Plochu e-mailu kreslí role `surface.canvas` a `surface.content`, nic jiného.
 * Panel do nich proto píše přímo, do mapy `theme.colors`, kterou čte
 * `resolveTheme`. Cesta s tečkou tady použít nejde: jméno role tečku obsahuje,
 * takže `setPath` by z `surface.canvas` udělal dvě zanořené úrovně.
 *
 * Značka projektu píše do TÉŽE mapy (`brandToTheme` přes `applyWorkspaceBrandTheme`),
 * a je to tak správně: značka dává výchozí hodnotu při zakládání dokumentu,
 * panel ji pak pro tenhle dokument přebije. Opačně to nejde, protože značka
 * se do hotového dokumentu už nedosazuje.
 */
const ROLE_KEYS = new Set<string>(['surface.canvas', 'surface.content']);

/**
 * Co má vzorník ukázat jako zvolenou hodnotu.
 *
 * Když dokument roli nemá, vrací se JMÉNO ROLE, ne její odstín. Vzorník pak
 * napíše „Plátno · #f4f5f7" a zvýrazní vzorek role, tedy „tuhle barvu jsi
 * zdědil". Kdyby se vracel rovnou odstín, hlásil by nedotčený motiv „Vlastní
 * barva", přestože si nikdo nic nevybral.
 *
 * Jakmile barva v dokumentu je, vrací se ona: uživatel si ji zvolil a má ji
 * vidět takovou, jaká je.
 */
const roleValue = (theme: Theme, role: string): string =>
  theme.colors?.[role as ThemeColorRole] ?? role;

/**
 * Do mapy rolí patří HEX, ne odkaz na roli.
 *
 * Vzorník nabízí i role motivu, a kdyby se do `colors` uložilo `brand.primary`,
 * `resolveTheme` by tu hodnotu vydal beze změny a do e-mailu by šel název role
 * místo barvy. Odkaz se proto rozřeší na odstín ve chvíli volby.
 */
const asHex = (theme: Theme, next: unknown): string | undefined => {
  if (typeof next !== 'string' || next === '') return undefined;
  return next.startsWith('#')
    ? next
    : resolveTheme(themeWithDefaults(theme)).light.color(next as ThemeColorRole);
};

const getPath = (source: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);

const setPath = (
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> => {
  const [head, ...rest] = path.split('.');
  if (!head) return source;
  if (rest.length === 0) return { ...source, [head]: value };
  return {
    ...source,
    [head]: setPath((source[head] as Record<string, unknown>) ?? {}, rest.join('.'), value),
  };
};

export function ThemePanel({
  contentKind = 'template',
}: {
  contentKind?: 'template' | 'campaign' | undefined;
}) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);

  return (
    <div className="flex flex-col gap-[var(--spacing-stack)]">
      <CardTitle>{t('theme.title')}</CardTitle>
      {contentKind === 'campaign' ? null : (
        <PropField
          {...FIELD_BASE}
          descriptor={PREVIEW_TEXT_PROP}
          value={document.meta.previewText ?? ''}
          // Jediné pole panelu, které nepíše do motivu, ale do `meta`.
          onChange={(next) => store.patchMeta({ previewText: String(next ?? '') })}
        />
      )}
      {THEME_GROUPS.map((group) => (
        // `min-w-0` a rytmus 15 px stejně jako v panelu vlastností, viz
        // `properties-panel.tsx`: `fieldset` se bez toho odmítá zúžit.
        <fieldset
          key={group.label}
          className="flex min-w-0 flex-col gap-[var(--spacing-stack)] border-t border-border pt-[var(--spacing-stack)]"
        >
          <legend className="meta-caps text-text-muted">{t(group.label)}</legend>
          {group.props.map((descriptor) =>
            ROLE_KEYS.has(descriptor.key) ? (
              <PropField
                key={descriptor.key}
                {...FIELD_BASE}
                descriptor={descriptor}
                value={roleValue(document.theme, descriptor.key)}
                onChange={(next) => {
                  const hex = asHex(document.theme, next);
                  if (hex === undefined) return;
                  store.patchTheme({
                    colors: { ...document.theme.colors, [descriptor.key]: hex },
                  } as Partial<Theme>);
                }}
              />
            ) : (
              <PropField
                key={descriptor.key}
                {...FIELD_BASE}
                descriptor={descriptor}
                value={getPath(
                  document.theme as unknown as Record<string, unknown>,
                  descriptor.key,
                )}
                onChange={(next) =>
                  store.patchTheme(
                    setPath(
                      document.theme as unknown as Record<string, unknown>,
                      descriptor.key,
                      next,
                    ) as unknown as Partial<Theme>,
                  )
                }
              />
            ),
          )}
        </fieldset>
      ))}
    </div>
  );
}
