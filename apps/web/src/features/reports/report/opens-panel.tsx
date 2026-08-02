'use client';

import { useFormatter, useTranslations } from 'next-intl';
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
      <section
        aria-labelledby="opens-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="opens-heading" className="text-base font-semibold">
          {t('report.opens.heading')}
        </h2>
        <p>{t('report.states.trackingOffOpens')}</p>
        <p className="text-sm text-text-muted">{t('report.states.trackingOffBody')}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="opens-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="opens-heading" className="text-base font-semibold">
        {t('report.opens.heading')}
      </h2>

      <p className="text-3xl font-semibold">
        {format.number(view.headlineCount ?? 0)}
        {view.rate === null ? null : (
          <span className="ml-2 text-base">
            {format.number(view.rate, { style: 'percent', maximumFractionDigits: 1 })}
          </span>
        )}
      </p>
      <p className="text-xs text-text-muted">{t(view.denominatorKey)}</p>
      {view.badgeKey === null ? null : (
        <p className="mt-1 inline-block rounded bg-warning-surface px-2 py-1 text-xs text-warning-text">
          {t(view.badgeKey)}
        </p>
      )}

      {/* Pruh tří skupin. Skupiny se liší i vzorem a popiskem, ne jen barvou. */}
      <div
        className="mt-3 flex h-4 overflow-hidden rounded border border-border"
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
      <ul className="mt-2 flex flex-wrap gap-4 text-sm">
        {view.segments.map((segment) => (
          <li key={segment.key}>
            {format.number(segment.count)} {t(`report.opens.${segment.key}`)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        {t('report.opens.clickedFromVerified', { count: view.clickedFromVerified })}
      </p>

      <p className="mt-2 text-sm text-warning-text">{t('report.opens.warning')}</p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === 'verified'}
          onChange={(event) => onModeChange(event.target.checked ? 'verified' : 'all')}
        />
        {t('report.opens.toggle.label')}
      </label>
      <p className="text-xs text-text-muted">
        {mode === 'verified'
          ? t('report.opens.toggle.onDescription')
          : t('report.opens.toggle.offDescription')}
      </p>

      {view.predicted === null ? null : (
        <p className="mt-3 text-sm italic text-text-muted">
          {t('report.opens.predicted.label')}:{' '}
          {t('report.opens.predicted.range', {
            low: format.number(view.predicted.low),
            high: format.number(view.predicted.high),
          })}
          {'. '}
          <span>{t('report.opens.predicted.hint')}</span>
        </p>
      )}

      <details className="mt-3">
        <summary>{t('report.opens.explainTitle')}</summary>
        <p>{t('report.opens.explainBody')}</p>
        <p>{t('report.opens.explainAdvice')}</p>
      </details>
    </section>
  );
}
