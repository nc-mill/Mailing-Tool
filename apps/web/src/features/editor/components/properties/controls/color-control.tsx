'use client';

import { useMemo } from 'react';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ThemeColorRole } from '@mlain/emails/document/types';
import { contrastRatio } from '@mlain/emails/theme/palette';
import { resolveTheme } from '@mlain/emails/theme/resolve';
import { DEFAULT_THEME, type Theme } from '../../../model/document-types';
import { useOptionalEditorState } from '../../../state/use-editor';
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
 * Doplnění chybějících částí motivu.
 *
 * `resolveTheme` čte `theme.darkMode.colors` a `theme.typography.*` bez
 * kontroly, takže nad dokumentem s neúplným motivem vyhodí
 * `Cannot read properties of undefined`. V klientské komponentě to neshodí
 * ovládací prvek, ale CELÝ strom po nejbližší error boundary, takže by uživatel
 * místo panelu vlastností dostal „Aplikace se neočekávaně zastavila".
 *
 * Uložený dokument má motiv vždy úplný (hlídá to JSON schéma i normalizace),
 * takže je to pojistka, ne běžná cesta. Slučuje se po částech, ne celý objekt
 * naráz: motiv s vlastními barvami a chybějícím tmavým režimem si má nechat
 * svoje barvy, ne spadnout na výchozí paletu.
 */
function withDefaults(theme: Theme | undefined): Theme {
  return {
    ...DEFAULT_THEME,
    ...theme,
    fonts: { ...DEFAULT_THEME.fonts, ...theme?.fonts },
    typography: { ...DEFAULT_THEME.typography, ...theme?.typography },
    darkMode: { ...DEFAULT_THEME.darkMode, ...theme?.darkMode },
    colors: { ...theme?.colors },
  };
}

export function ColorControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
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
  const resolved = useMemo(() => resolveTheme(withDefaults(theme)), [theme]);

  const isHex = typeof value === 'string' && value.startsWith('#');
  const selected = typeof value === 'string' ? value : null;

  /** Skutečná barva zvolené hodnoty ve světlém režimu. `null` u „Průhledné". */
  const shown = useMemo(() => {
    if (selected === null) return null;
    return resolved.light.color(selected as never);
  }, [resolved, selected]);

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

  const label = isHex ? t('value.color.custom') : selected === null ? t('value.color.none') : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/*
          Vzorek zvolené hodnoty. `aria-hidden`, protože tutéž informaci nese
          název v nabídce vedle a hex pod ní: kdo barvy nerozlišuje, přijde
          nanejvýš o ozdobu, ne o informaci.
        */}
        <span
          aria-hidden="true"
          data-testid={`color-swatch-${descriptor.key}`}
          className="inline-block size-9 shrink-0 rounded-[var(--radius-control)] border border-border-strong"
          style={
            shown === null
              ? // Průhledné se kreslí šachovnicí, ne bílou: bílá je platná barva
                // a od „nic tu není" by nešla rozeznat.
                {
                  backgroundImage:
                    'linear-gradient(45deg,var(--color-border) 25%,transparent 25%,transparent 75%,var(--color-border) 75%),linear-gradient(45deg,var(--color-border) 25%,transparent 25%,transparent 75%,var(--color-border) 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 4px 4px',
                }
              : { backgroundColor: shown }
          }
        />
        <select
          id={id}
          data-autofocus={autoFocus ? '' : undefined}
          className="h-9 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
          value={isHex ? '$custom' : String(value ?? '$none')}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '$none') onChange(null);
            else if (next === '$custom') onChange('#000000');
            else onChange(next);
          }}
        >
          {descriptor.nullable ? <option value="$none">{t('value.color.none')}</option> : null}
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`value.color.${role}`)}
            </option>
          ))}
          <option value="$custom">{t('value.color.custom')}</option>
        </select>
        {isHex ? (
          <Input
            type="color"
            aria-label={t('value.color.custom')}
            value={String(value)}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="h-9 w-12 shrink-0 p-1"
          />
        ) : null}
      </div>

      {/*
        Pás vzorků. Nabídka výš je pořád hlavní ovládání (nese popisek pole,
        chodí z klávesnice a čte se čtečkou), tohle je druhá cesta k témuž:
        deset rolí VIDĚT naráz. Bez ní si uživatel musel deset názvů typu
        „Jemné pozadí" postupně vyzkoušet, aby zjistil, jakou barvu vybírá.

        Přístupné jméno každého tlačítka je NÁZEV ROLE PLUS HEX, ne jen barva.
        Barva je doplněk názvu, ne náhrada.
      */}
      <div
        role="group"
        aria-label={t('value.color.paletteLabel')}
        className="flex flex-wrap gap-1"
        data-testid={`color-palette-${descriptor.key}`}
      >
        {ROLES.map((role) => {
          const hex = resolved.light.roles[role];
          const active = selected === role;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              title={`${t(`value.color.${role}`)} ${hex}`}
              aria-label={`${t(`value.color.${role}`)} ${hex}`}
              onClick={() => onChange(role)}
              className={`size-6 rounded border ${active ? 'border-border-strong ring-2 ring-focus' : 'border-border'}`}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      {/*
        Název a hodnota v textu. Zůstává i bez rozeznávání barev a je to jediné
        místo, kde je hex vidět bez otevírání nabídky.
      */}
      <p className="text-xs text-text-muted">
        {label ?? t(`value.color.${selected}`)}
        {shown === null ? '' : ` · ${shown}`}
      </p>

      {lowContrast ? (
        <p role="status" className="text-xs text-warning-text">
          {t('issue.content_low_contrast')}
        </p>
      ) : null}
    </div>
  );
}
