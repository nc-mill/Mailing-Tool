'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { opensView, type OpensMode, type StatsPayload } from './report-model';

export function OpensPanel({
  payload,
  mode,
  onModeChange,
}: {
  payload: StatsPayload;
  mode: OpensMode;
  onModeChange: (mode: OpensMode) => void;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const view = opensView(payload, mode);

  if (view.disabled) {
    return (
      <Card aria-labelledby="opens-heading">
        <CardTitle>
          <span id="opens-heading">{t('report.opens.heading')}</span>
        </CardTitle>
        <p className="text-ui text-text">{t('report.states.trackingOffOpens')}</p>
        <p className="text-meta text-text-muted">{t('report.states.trackingOffBody')}</p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="opens-heading">
      {/* Nadpis a jmenovatel stojí na jedné lince: „Otevření · z doručených". */}
      <div className="flex flex-wrap items-baseline gap-[var(--spacing-stack)]">
        <CardTitle>
          <span id="opens-heading">{t('report.opens.heading')}</span>
        </CardTitle>
        <span className="font-mono text-meta text-text-muted">{t(view.denominatorKey)}</span>
        {view.badgeKey === null ? null : (
          <span className="meta-caps rounded-[var(--radius-control)] bg-warning-surface px-2 py-[3px] text-warning-text">
            {t(view.badgeKey)}
          </span>
        )}
      </div>

      {/*
       * Čtyři stavy metriky rozhoduje `metricDisplay` v jádře, ne tenhle
       * soubor. Stav `not_measured` je vyřízený větví výš, kde má panel celou
       * vlastní podobu; tady zbývá míra, míra z malého vzorku a pomlčka.
       */}
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text">
          {format.number(view.headlineCount ?? 0)}
        </span>
        {view.display.kind === 'dash' || view.display.kind === 'not_measured' ? null : (
          <span className="text-ui text-text-muted">
            {format.number(view.display.rate, { style: 'percent', maximumFractionDigits: 1 })}
          </span>
        )}
      </p>
      {view.display.kind === 'absolute' ? (
        <p className="text-meta text-text-muted">{t('report.states.smallSample')}</p>
      ) : null}

      {/* Pruh tří skupin. Skupiny se liší i vzorem a popiskem, ne jen barvou. */}
      <div
        className="flex h-2.5 overflow-hidden rounded-[var(--radius-control)] bg-success-surface"
        role="img"
        aria-label={t('report.opens.heading')}
      >
        {view.segments.map((segment) => (
          <div
            key={segment.key}
            style={{ width: `${Math.round(segment.share * 100)}%` }}
            className={
              segment.key === 'verified'
                ? 'bg-success'
                : segment.key === 'machine'
                  ? 'bg-border-strong bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.5)_4px,rgba(255,255,255,.5)_8px)]'
                  : 'bg-surface-muted'
            }
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-[var(--spacing-gutter)]">
        {view.segments.map((segment) => (
          <li
            key={segment.key}
            className={`font-mono text-sm ${segment.key === 'verified' ? 'text-text' : 'text-text-muted'}`}
          >
            {format.number(segment.count)} {t(`report.opens.${segment.key}`)}
          </li>
        ))}
      </ul>
      <p className="font-mono text-sm text-text-muted">
        {t('report.opens.clickedFromVerified', { count: view.clickedFromVerified })}
      </p>

      <p className="text-ui text-warning-text">{t('report.opens.warning')}</p>

      <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)] text-ui text-text">
        <Checkbox
          checked={mode === 'verified'}
          onCheckedChange={(next) => onModeChange(next === true ? 'verified' : 'all')}
        />
        {t('report.opens.toggle.label')}
      </label>
      <p className="text-meta text-text-muted">
        {mode === 'verified'
          ? t('report.opens.toggle.onDescription')
          : t('report.opens.toggle.offDescription')}
      </p>

      {view.predicted === null ? null : (
        <p className="text-ui italic text-text-muted">
          {t('report.opens.predicted.label')}:{' '}
          {t('report.opens.predicted.range', {
            low: format.number(view.predicted.low),
            high: format.number(view.predicted.high),
          })}
          {'. '}
          <span>{t('report.opens.predicted.hint')}</span>
        </p>
      )}

      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-ui text-accent-text">
          {t('report.opens.explainTitle')}
        </summary>
        <p className="pt-[var(--spacing-inline)] text-meta text-text-muted">
          {t('report.opens.explainBody')}
        </p>
        <p className="pt-[var(--spacing-inline)] text-meta text-text-muted">
          {t('report.opens.explainAdvice')}
        </p>
      </details>
    </Card>
  );
}
