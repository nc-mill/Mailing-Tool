'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ThemeColorRole } from '@mlain/emails/document/types';
import { contrastRatio } from '@mlain/emails/theme/palette';
import { resolveTheme } from '@mlain/emails/theme/resolve';
import { DEFAULT_THEME, themeWithDefaults, type Theme } from '../../../model/document-types';
import { useOptionalEditorState } from '../../../state/use-editor';
import { Plus } from '../../icons';
import type { ControlProps } from '../prop-field';

const ROLES: readonly ThemeColorRole[] = [
  'brand.primary',
  'brand.secondary',
  'brand.accent',
  'text.default',
  'text.muted',
  'text.inverted',
  'surface.canvas',
  'surface.content',
  'surface.subtle',
  'link.default',
];

/**
 * Vlastnost, u které má smysl měřit kontrast.
 *
 * Je to PŘESNĚ pravidlo, které už produkt má: `checkSemanticFields`
 * (`packages/emails/src/document/semantic-fields.ts`) hlásí
 * `content_low_contrast` nad `props.color` každého bloku, měřeno proti
 * `surface.content` ve světlém i tmavém režimu, práh 4,5:1. Vlastní, jinak
 * postavené varování by uživateli tvrdilo něco jiného než lišta nálezů nad
 * plátnem, a jedno z těch dvou by muselo lhát.
 */
const CONTRAST_KEY = 'color';

/** Práh 4,5:1 z WCAG AA pro běžný text. Tentýž, na kterém stojí nález. */
const CONTRAST_MIN = 4.5;

/**
 * Odstín, se kterým se otevře systémový výběr, když se z aktuální hodnoty
 * nedá odvodit. `input type="color"` přijímá jen zápis `#rrggbb`; cokoli
 * jiného prohlížeč tiše přepíše na černou, takže je lepší ji dosadit vědomě.
 */
const CUSTOM_FALLBACK = '#000000';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Průhledné se kreslí šachovnicí, ne bílou: bílá je platná barva a od
 * „nic tu není" by nešla rozeznat.
 */
const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg,var(--color-border) 25%,transparent 25%,transparent 75%,var(--color-border) 75%),linear-gradient(45deg,var(--color-border) 25%,transparent 25%,transparent 75%,var(--color-border) 75%)',
  backgroundSize: '10px 10px',
  backgroundPosition: '0 0, 5px 5px',
} as const;

/** Buňka vzorníku. Celá plocha je barva a celá plocha je klikací cíl. */
const CELL = [
  'min-h-[var(--size-target-min)] w-full rounded-[var(--radius-control)]',
  'flex items-center justify-center',
].join(' ');

/**
 * Zvolený vzorek se pozná DVOJITOU LINKOU, ne jen tmavým rámečkem.
 *
 * Samotný `border-text` je téměř černý, takže na tmavém vzorku (Text
 * `#111827`) splyne a zvolená barva nejde poznat. Vnitřní linka v barvě
 * papíru je vidět na tmavém vzorku, vnější tmavá na světlém, takže je
 * volba čitelná na obou koncích palety. Stav navíc nese `aria-pressed`,
 * takže na barvě nestojí sám.
 */
const selectedEdge = (active: boolean) =>
  active
    ? 'border-2 border-text shadow-[inset_0_0_0_var(--border-accent)_var(--color-surface)]'
    : 'border border-border-strong';

export function ColorControl({
  descriptor,
  value,
  onChange,
  id,
  labelId,
  autoFocus,
}: ControlProps) {
  const t = useTranslations('editor');

  /*
   * Motiv se čte z dokumentu, ne z barevných proměnných aplikace: vzorek má
   * ukazovat barvu, kterou dostane PŘÍJEMCE E-MAILU, ne barvu rozhraní.
   * Rozřeší ho `resolveTheme`, tedy tatáž funkce, kterou volá emitter při
   * skládání e-mailu i plátno editoru, takže se ty tři nemůžou rozejít.
   *
   * Mimo `EditorStoreProvider` (samostatně vykreslené ovládání v testech)
   * se použije výchozí motiv. Vzorek pak ukazuje výchozí paletu, což je pořád
   * lepší než shozený panel vlastností.
   */
  const theme = useOptionalEditorState<Theme>((state) => state.document.theme, DEFAULT_THEME);
  const resolved = useMemo(() => resolveTheme(themeWithDefaults(theme)), [theme]);

  const isHex = typeof value === 'string' && value.startsWith('#');
  const selected = typeof value === 'string' ? value : null;

  /*
   * Paleta, ze které se kreslí vzorník i hex pod ním.
   *
   * Pole tmavého režimu (`descriptor.scheme: 'dark'`) musí ukazovat odstíny
   * z tmavé palety. Se světlými vzorky by uživatel klikl na téměř bílé plátno
   * a příjemce by v tmavém režimu dostal skoro černé, tedy vzorník by lhal.
   *
   * Kontrast se tímhle NEŘÍDÍ, ten se níž měří v obou paletách naráz, protože
   * přesně tak ho měří `checkSemanticFields`.
   */
  const palette = descriptor.kind === 'color' && descriptor.scheme === 'dark' ? 'dark' : 'light';

  /** Skutečná barva zvolené hodnoty ve zvolené paletě. `null` u „Průhledné". */
  const shown = useMemo(() => {
    if (selected === null) return null;
    return resolved[palette].color(selected as never);
  }, [resolved, selected, palette]);

  /*
   * Kontrast se počítá ve světlém i tmavém režimu, stejně jako ho počítá
   * validátor. Tmavý se měří vždycky, i když má motiv `darkMode.strategy: off`:
   * dělá to tak `checkSemanticFields` a dvě různá čísla pod týmž názvem by byla
   * horší než jedno přísnější.
   */
  const lowContrast = useMemo(() => {
    if (descriptor.key !== CONTRAST_KEY || selected === null) return false;
    const light = contrastRatio(
      resolved.light.color(selected as never),
      resolved.light.roles['surface.content'],
    );
    const dark = contrastRatio(
      resolved.dark.color(selected as never),
      resolved.dark.roles['surface.content'],
    );
    return light < CONTRAST_MIN || dark < CONTRAST_MIN;
  }, [descriptor.key, resolved, selected]);

  if (descriptor.kind !== 'color') return <></>;

  const name = isHex
    ? t('value.color.custom')
    : selected === null
      ? t('value.color.none')
      : t(`value.color.${selected}`);

  /*
   * Odstín, se kterým se otevře systémový výběr. Když je vybraná role motivu,
   * otevře se na její barvě, takže uživatel ladí od toho, co vidí, a nezačíná
   * pokaždé u černé.
   */
  const pickerValue = isHex
    ? String(value)
    : typeof shown === 'string' && HEX.test(shown)
      ? shown
      : CUSTOM_FALLBACK;

  /*
   * Hodnota, která není ani hex, ani známá role motivu (například barva
   * z importu nebo ze staršího dokumentu), nemá kde vzít odstín: `color()`
   * v `resolveTheme` u neznámé role vrátí `undefined`. Do textu se pak psalo
   * „ · undefined". Radši se v takovém případě hex vynechá; sám název pořád
   * říká, co v dokumentu stojí, a kliknutím na vzorek to jde přepsat.
   */
  const shownHex = typeof shown === 'string' && HEX.test(shown) ? shown : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/*
        VZORNÍK JE JEDINÉ OVLÁDÁNÍ BARVY. Rozbalovací pole nad ním bylo třetí
        cesta k téže hodnotě (vzorek, nabídka, vzorník) a jeho nejdelší položka
        („Doplňková barva značky") si vynucovala šířku, kterou panel nemá:
        obsah pak přetékal do vodorovného posuvu. Co nabídka uměla navíc, tedy
        „Průhledné" a „Vlastní barva", jsou dnes poslední dva vzorky.

        Mřížka má PEVNÝ POČET SLOUPCŮ, ne zalomení podle šířky: pět buněk na
        řadu vychází v panelu na 48 px, tedy nad klikací plochou 44 px, a řady
        se nezalomí do useknuté poloviny.
      */}
      <div
        id={id}
        role="group"
        aria-labelledby={labelId}
        data-testid={`color-palette-${descriptor.key}`}
        className="grid grid-cols-5 gap-1"
      >
        {ROLES.map((role, index) => {
          const hex = resolved[palette].roles[role];
          const active = selected === role;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              data-autofocus={autoFocus && index === 0 ? '' : undefined}
              // Přístupné jméno je NÁZEV ROLE PLUS HEX, ne jen barva. Barva je
              // doplněk názvu, ne náhrada.
              title={`${t(`value.color.${role}`)} ${hex}`}
              aria-label={`${t(`value.color.${role}`)} ${hex}`}
              onClick={() => onChange(role)}
              className={`${CELL} ${selectedEdge(active)}`}
              style={{ backgroundColor: hex }}
            />
          );
        })}

        {descriptor.nullable ? (
          <button
            type="button"
            aria-pressed={selected === null}
            title={t('value.color.none')}
            aria-label={t('value.color.none')}
            data-testid={`color-none-${descriptor.key}`}
            onClick={() => onChange(null)}
            className={`${CELL} ${selectedEdge(selected === null)}`}
            style={CHECKERBOARD}
          />
        ) : null}

        {/*
          Vlastní barva otevře systémový výběr rovnou. Dřív se musela nejdřív
          zvolit v nabídce (což hodnotu přepsalo na černou) a teprve pak se
          vedle objevilo pole s výběrem.

          Pole je průhledné přes celou buňku, aby byl klikací cíl celá buňka
          a systémový výběr se otevřel u ní. Obrys zaostření kreslí obal, protože
          na neviditelném poli by ho nikdo neviděl.
        */}
        <label
          data-testid={`color-custom-${descriptor.key}`}
          title={t('value.color.custom')}
          className={[
            CELL,
            selectedEdge(isHex),
            'relative cursor-pointer bg-field',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
            'has-[:focus-visible]:outline-[var(--color-focus-ring)]',
          ].join(' ')}
          style={isHex ? { backgroundColor: String(value) } : undefined}
        >
          {isHex ? null : <Plus aria-hidden className="icon-sm text-text-muted" />}
          <input
            type="color"
            aria-label={t('value.color.custom')}
            value={pickerValue}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>

        {/*
          Název a hodnota v textu. Zůstává i bez rozeznávání barev a je to
          jediné místo, kde je hex vidět jako text. Sedí ve zbytku poslední
          řady, takže po ní nezůstane useknutý pruh prázdných buněk.
        */}
        <p
          data-testid={`color-value-${descriptor.key}`}
          className={`self-center ps-1 font-mono text-label text-text-muted ${
            descriptor.nullable ? 'col-span-3' : 'col-span-4'
          }`}
        >
          {name}
          {shownHex === null ? '' : ` · ${shownHex}`}
        </p>
      </div>

      {lowContrast ? (
        <p role="status" className="text-meta text-warning-text">
          {t('issue.content_low_contrast')}
        </p>
      ) : null}
    </div>
  );
}
