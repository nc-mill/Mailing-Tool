'use client';

import { useTranslations } from 'next-intl';
import type { ThemeColorRole } from '@mlain/emails/document/types';
import { brandToTheme } from '@mlain/emails/base/brand';
import { contrastRatio } from '@mlain/emails/theme/palette';
import { resolveTheme } from '@mlain/emails/theme/resolve';

export type BrandThemePreviewProps = {
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: { headingStack: string; bodyStack: string; radius: number };
};

/**
 * Role, které se z pěti barev značky ODVOZUJÍ, a proto se na obrazovce
 * nenastavují. Seznam není názor, je opsaný z `brandToTheme`
 * (`packages/emails/src/base/brand.ts`), který je zdrojem pravdy:
 *
 *   surface.content  je vždy bílá (podklad obsahu e-mailu)
 *   surface.subtle   = pozadí ztmavené o 5 %
 *   text.muted       = text zesvětlený o 35 %
 *   text.inverted    = bílá nebo tmavá, podle toho, co je čitelné na hlavní barvě
 *   link.default     = hlavní barva ztmavená, dokud nemá na bílé kontrast 4,5:1
 *
 * Kdyby šly nastavit i tyhle, obrazovka by slibovala nastavení, které
 * `brandToTheme` při skládání šablony zase přepíše.
 */
const DERIVED: ReadonlySet<ThemeColorRole> = new Set([
  'surface.content',
  'surface.subtle',
  'text.muted',
  'text.inverted',
  'link.default',
]);

/** Pořadí je stejné jako v nabídce barev v editoru, ať se to dá porovnat očima. */
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

/** Role, u kterých má smysl měřit kontrast: nesou text, ne pozadí. */
const TEXT_ROLES: ReadonlySet<ThemeColorRole> = new Set([
  'text.default',
  'text.muted',
  'link.default',
]);

/**
 * Co z nastavených barev doopravdy vznikne.
 *
 * Počítá to `brandToTheme` a `resolveTheme` z `@mlain/emails`, tedy TYTÉŽ
 * funkce, kterými prochází skládání šablony a vykreslení e-mailu. Druhá kopie
 * téhle matematiky by se rozešla a obrazovka by rok ukazovala barvy, které
 * do e-mailu nikdy nešly.
 *
 * Bez tabulky by uživatel neměl jak zjistit, že „Ztlumený text" nebo „Odkaz"
 * se odvozují, a hledal by je v nastavení. To je přesně stížnost, kvůli které
 * tahle obrazovka vznikla, jen o úroveň níž.
 */
export function BrandThemePreview({ palette, typography }: BrandThemePreviewProps) {
  const t = useTranslations('ai');
  const tEditor = useTranslations('editor');

  const theme = resolveTheme(brandToTheme({ palette, typography }));
  const content = theme.light.roles['surface.content'];

  return (
    <section aria-labelledby="brand-theme-preview" className="flex flex-col gap-3">
      <div>
        <h3 id="brand-theme-preview" className="font-medium text-text">
          {t('brand.themeTitle')}
        </h3>
        <p className="mt-1 max-w-prose text-sm text-text-muted">{t('brand.themeIntro')}</p>
      </div>

      <ul className="flex flex-col divide-y divide-border" data-testid="brand-theme-roles">
        {ROLES.map((role) => {
          const value = theme.light.roles[role];
          const ratio = TEXT_ROLES.has(role) ? contrastRatio(value, content) : null;
          return (
            <li key={role} className="flex flex-wrap items-center gap-3 py-2" data-role={role}>
              <span
                aria-hidden="true"
                className="inline-block size-6 shrink-0 rounded border border-border-strong"
                style={{ backgroundColor: value }}
              />
              <span className="min-w-44 flex-1 text-sm text-text">
                {tEditor(`value.color.${role}`)}
              </span>
              <code className="font-mono text-sm text-text">{value}</code>
              <span className="text-sm text-text-muted">
                {DERIVED.has(role) ? t('brand.roleDerived') : t('brand.roleDirect')}
              </span>
              {ratio !== null && ratio < 4.5 ? (
                <span className="text-sm text-warning-text">
                  {tEditor('issue.content_low_contrast')}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
