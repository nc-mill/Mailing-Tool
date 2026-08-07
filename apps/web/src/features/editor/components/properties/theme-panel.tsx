'use client';

import type { ColorRef, ThemeColorRole } from '@mlain/emails/document/types';
import { CardTitle } from '@mlain/ui/components/card';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import { THEME_GROUPS } from '../../descriptors/theme';
import type { PropDescriptor } from '../../descriptors/types';
import type { Theme } from '../../model/document-types';
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

/** Předpona klíče pole, které míří do tmavé palety, ne do světlé. */
const DARK_PREFIX = 'dark:';

/**
 * KAM POLE PANELU UKLÁDÁ. Jediné místo, které o tom rozhoduje.
 *
 * Čtení i zápis se ptají téhle funkce, takže se nemůžou rozejít. Dřív to byla
 * jedna podmínka u hodnoty a druhá u obsluhy; se dvěma paletami by z toho byly
 * čtyři kopie téhož rozhodnutí a stačilo by opravit tři z nich.
 *
 * `null` znamená „tohle není barva role", tedy běžné pole motivu adresované
 * cestou s tečkou (`typography.baseFontSize` a spol.).
 */
type ColorTarget = { scheme: 'light' | 'dark'; role: ThemeColorRole };

function colorTarget(key: string): ColorTarget | null {
  const dark = key.startsWith(DARK_PREFIX);
  const role = dark ? key.slice(DARK_PREFIX.length) : key;
  if (!ROLE_KEYS.has(role)) return null;
  return { scheme: dark ? 'dark' : 'light', role: role as ThemeColorRole };
}

/** Mapa barev té palety, do které cíl míří. Obě jsou částečné, chybějící role dědí. */
const schemeColors = (theme: Theme, scheme: 'light' | 'dark') =>
  (scheme === 'dark' ? theme.darkMode?.colors : theme.colors) ?? {};

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
const roleValue = (theme: Theme, target: ColorTarget): string =>
  schemeColors(theme, target.scheme)[target.role] ?? target.role;

/**
 * Do mapy rolí se ukládá TO, CO UŽIVATEL ZVOLIL: hex u vlastní barvy, jméno
 * role u role.
 *
 * Dřív se odkaz na roli rozřešil na odstín hned při volbě. „Pozadí plátna =
 * hlavní barva značky" se tím zmrazilo na konkrétní odstín a po změně značky
 * projektu zůstalo staré, přestože uživatel volbou řekl vazbu, ne barvu.
 * Rozvazuje ji `resolveTheme` až při vykreslení, takže do e-mailu odchází
 * pořád hex a jméno role se v HTML objevit nemůže.
 *
 * Prázdný řetězec a nezvolená hodnota se zahazují: mapa rolí je částečná
 * a role bez hodnoty znamená „vezmi výchozí", což se zapisuje vynecháním,
 * ne prázdnou hodnotou.
 */
const asColorRef = (next: unknown): ColorRef | undefined => {
  if (typeof next !== 'string' || next === '') return undefined;
  return next as ColorRef;
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
          {group.props.map((descriptor) => {
            const target = colorTarget(descriptor.key);
            /*
             * Plochy tmavého režimu při vypnutém tmavém režimu ZMIZÍ, ne
             * zašednou. Emitter tmavou paletu při `strategy: 'off'` nevydá
             * vůbec (`head-css.ts`), takže by to byla pole, po kterých se
             * v e-mailu nic nepozná.
             */
            if (target?.scheme === 'dark' && document.theme.darkMode?.strategy !== 'auto') {
              return null;
            }
            /*
             * Plochy tmavého režimu při vypnutém tmavém režimu ZMIZÍ, ne
             * zašednou. Emitter tmavou paletu při `strategy: 'off'` nevydá
             * vůbec (`head-css.ts`), takže by to byla pole, po kterých se
             * v e-mailu nic nepozná.
             */

            return target !== null ? (
              <PropField
                key={descriptor.key}
                {...FIELD_BASE}
                descriptor={descriptor}
                value={roleValue(document.theme, target)}
                onChange={(next) => {
                  const ref = asColorRef(next);
                  if (ref === undefined) return;
                  const colors = {
                    ...schemeColors(document.theme, target.scheme),
                    [target.role]: ref,
                  };
                  store.patchTheme(
                    (target.scheme === 'dark'
                      ? { darkMode: { ...document.theme.darkMode, colors } }
                      : { colors }) as Partial<Theme>,
                  );
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
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
