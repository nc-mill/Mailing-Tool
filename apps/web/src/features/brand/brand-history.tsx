'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { CheckIcon, RunningIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { brandErrorKey } from './extraction-form';

/** Jeden běh stažení, tak jak ho vydává `listBrandExtractionHistory`. */
export type BrandExtractionView = {
  id: string;
  url: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked';
  errorCode: string | null;
  warnings: string[];
  palette: Record<string, string> | null;
  createdAt: string;
  finishedAt: string | null;
};

/** Pořadí barev v ukázce. Odpovídá pořadí polí ve formuláři nad historií. */
const ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;

/**
 * Co se na webu nenašlo, v KRÁTKÉM tvaru. `logo_not_measured`
 * a `tone_inference_disabled` se schválně neukazují: týkají se rozměrů obrázku
 * a odhadu tónu, tedy věcí, o kterých tahle obrazovka nerozhoduje.
 *
 * Dlouhé věty s návodem („Nastavte je prosím ručně nahoře") patří k PRÁVĚ
 * doběhnutému běhu, ne do historie: u deseti řádků by z nich byla stěna textu,
 * která desetkrát radí totéž. Historie říká jen, co z webu nepřišlo.
 */
const MISSING: Array<[string, string]> = [
  ['colors_not_found', 'missingColors'],
  ['fonts_not_found', 'missingFonts'],
  ['logo_not_found', 'missingLogo'],
];

const STATUS: Record<
  BrandExtractionView['status'],
  { key: string; tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: React.ReactNode }
> = {
  succeeded: { key: 'succeeded', tone: 'success', icon: CheckIcon },
  failed: { key: 'failed', tone: 'danger', icon: WarningIcon },
  blocked: { key: 'blocked', tone: 'warning', icon: SlashIcon },
  running: { key: 'running', tone: 'neutral', icon: RunningIcon },
  pending: { key: 'running', tone: 'neutral', icon: RunningIcon },
};

/**
 * Historie stažení značky.
 *
 * NA MÍSTĚ, KDE BYLY „ULOŽENÉ ZNAČKY". Ten seznam vypisoval profily, a protože
 * každé stažení zakládalo další, ukazoval šestkrát tentýž web a nešlo v něm nic
 * vybrat, přejmenovat ani smazat. Zadavatel se ptal, k čemu to je, a měl pravdu:
 * projekt má jednu značku (formulář nahoře) a tohle je záznam BĚHŮ, ne druhá
 * sada značek.
 *
 * Každý řádek proto říká kdy, odkud a co z webu přišlo. Barvy se berou
 * z `brand_extractions.result`, ne z profilu: profil drží jen výsledek
 * posledního běhu, protože ho každé další stažení přepíše.
 */
export function BrandHistory({ runs }: { runs: readonly BrandExtractionView[] }) {
  const t = useTranslations('ai');
  const format = useFormatter();

  return (
    <section aria-labelledby="brand-history">
      <h2 id="brand-history" className="text-xl font-semibold text-text">
        {t('brand.historyTitle')}
      </h2>
      <p className="mt-1 text-text-muted">{t('brand.historyIntro')}</p>

      {runs.length === 0 ? (
        <p className="mt-4 text-text-muted">{t('brand.historyEmpty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {runs.map((run, index) => {
            const status = STATUS[run.status];
            return (
              <li key={run.id} data-testid="brand-history-row" className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={status.tone} icon={status.icon}>
                    {t(`brandHistory.${status.key}`)}
                  </Badge>
                  <span className="font-medium text-text">{run.url}</span>
                  {/*
                    Formát s hodinou a minutou, ne `short`. Běhy bývají pár
                    minut od sebe (uživatel zkouší adresu znovu), takže samotné
                    datum by u šesti řádků řeklo šestkrát totéž.
                  */}
                  <time className="text-sm text-text-muted" dateTime={run.createdAt}>
                    {format.dateTime(new Date(run.createdAt), 'dateTime')}
                  </time>
                  {/*
                    Který běh vyrobil značku, kterou projekt používá teď. Je to
                    vždycky nejnovější úspěšný, protože stažení tu jednu značku
                    přepisuje; bez toho by se z historie nedalo poznat, odkud
                    barvy ve formuláři nahoře jsou.
                  */}
                  {run.status === 'succeeded' &&
                  runs.findIndex((item) => item.status === 'succeeded') === index ? (
                    <Badge tone="accent" icon={CheckIcon}>
                      {t('brand.historyCurrent')}
                    </Badge>
                  ) : null}
                </div>

                {/*
                  Paleta se ukáže JEN TEHDY, když se opravdu něco našlo.
                  Běh s varováním `colors_not_found` uložil neutrální výchozí
                  barvy, a vypsat je jako „stažené" by o cizím webu lhalo;
                  místo nich je vidět to varování o řádek níž.
                */}
                {run.palette === null || run.warnings.includes('colors_not_found') ? null : (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                    <span>{t('brand.historyColors')}</span>
                    {ROLES.filter((role) => run.palette?.[role] !== undefined).map((role) => (
                      <span key={role} className="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="inline-block size-4 rounded border border-border"
                          style={{ backgroundColor: run.palette?.[role] }}
                        />
                        <span className="font-mono">{run.palette?.[role]}</span>
                      </span>
                    ))}
                  </p>
                )}

                {run.errorCode === null ? null : (
                  <p className="text-sm text-danger-text">
                    {t(`brandErrors.${brandErrorKey(run.errorCode)}`, {
                      url: run.url,
                      host: hostOf(run.url),
                      limit: 10,
                    })}
                  </p>
                )}

                {run.status === 'succeeded' &&
                MISSING.some(([code]) => run.warnings.includes(code)) ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                    <span>{t('brandHistory.notFound')}</span>
                    {MISSING.filter(([code]) => run.warnings.includes(code)).map(([code, key]) => (
                      <span key={code} className="rounded bg-surface-muted px-2 py-0.5">
                        {t(`brandHistory.${key}`)}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
