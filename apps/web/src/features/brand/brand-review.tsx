'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

export type BrandProfileView = {
  id: string;
  name: string;
  logoAssetId: string | null;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    source: Record<string, string>;
  };
  typography: { headingStack: string; bodyStack: string; radius: number };
};

const SOURCE_KEYS: Record<string, string> = {
  meta: 'sourceMeta',
  'css-var': 'sourceCssVar',
  'css-selector': 'sourceCssSelector',
  'css-freq': 'sourceCssFreq',
  logo: 'sourceLogo',
  fallback: 'sourceFallback',
};

/**
 * Kontrola výsledku. U každé barvy je vidět, odkud jsme ji vzali: uživatel
 * s brand manuálem musí poznat, jestli sedí, nebo jestli jsme trefili
 * nejčastější barvu na stránce.
 */
export function BrandReview({
  profile,
  onApplyToAll,
}: {
  profile: BrandProfileView;
  onApplyToAll?: () => void;
}) {
  const t = useTranslations('ai');

  const rows = [
    { key: 'primary', label: t('brand.primary'), value: profile.palette.primary },
    { key: 'secondary', label: t('brand.secondary'), value: profile.palette.secondary },
    { key: 'accent', label: t('brand.buttonColor'), value: profile.palette.accent },
  ];

  return (
    <section
      data-testid="brand-review"
      className="flex flex-col gap-6 rounded-[var(--radius-surface)] border border-border bg-surface p-6"
    >
      <div>
        <h3 className="font-medium text-text">{t('brand.logo')}</h3>
        <div className="mt-2 flex items-center gap-3">
          {profile.logoAssetId === null ? (
            <Button type="button" variant="secondary">
              {t('brand.logoUpload')}
            </Button>
          ) : (
            <>
              <img
                alt={profile.name}
                src={`/api/v1/assets/${profile.logoAssetId}`}
                className="h-10 w-auto"
              />
              <Button type="button" variant="secondary">
                {t('brand.logoReplace')}
              </Button>
              <Button type="button" variant="ghost">
                {t('brand.logoRemove')}
              </Button>
            </>
          )}
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-3">
            <dt className="w-40 text-text">{row.label}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-5 rounded border border-border"
                style={{ backgroundColor: row.value }}
              />
              <code className="text-text">{row.value}</code>
              <span className="text-sm text-text-muted">
                {t(
                  `brand.${SOURCE_KEYS[profile.palette.source[row.key] ?? 'fallback'] ?? 'sourceFallback'}`,
                )}
              </span>
              <Button type="button" variant="ghost">
                {t('brand.change')}
              </Button>
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="font-medium text-text">{t('brand.font')}</h3>
        <p className="text-text">
          {t('brand.fontValue', {
            heading: profile.typography.headingStack,
            body: profile.typography.bodyStack,
          })}
        </p>
        <p className="mt-1 max-w-prose text-sm text-text-muted">{t('brand.fontNote')}</p>
      </div>

      <div>
        <Button type="button" onClick={onApplyToAll}>
          {t('brand.applyToAll')}
        </Button>
      </div>
    </section>
  );
}
