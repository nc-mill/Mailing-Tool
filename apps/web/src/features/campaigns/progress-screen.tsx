'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Progress } from '@mlain/ui/components/progress';
import { Alert } from '@mlain/ui/patterns/states';
import { StatusBadge } from './status-badge';
import { UndoCountdown } from './undo-countdown';

export type CampaignProgress = {
  campaign_id: string;
  status: string;
  counters: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    delivered: number;
    bounced: number;
    complained: number;
    pending: number;
  };
  ambiguous_count: number;
  rate_per_second: number | null;
  eta_seconds: number | null;
  stalled: boolean;
  pause_reason: { code: string; source: string; at: string; detail?: string } | null;
  undo_remaining_seconds: number;
  updated_at: string;
};

const PAUSE_KEY: Record<string, string> = {
  render_failure_rate: 'renderFailureRate',
  credentials_undecryptable: 'credentialsUndecryptable',
  provider_quota_exhausted: 'providerQuotaExhausted',
  provider_unavailable: 'providerUnavailable',
  user: 'user',
  bounce_guard: 'bounceGuard',
  complaint_guard: 'complaintGuard',
  provider_blocked: 'providerBlocked',
  materialize_timeout: 'materializeTimeout',
};

export function ProgressScreen({
  progress,
  onPause,
  onResume,
  onCancel,
  onUndo,
}: {
  progress: CampaignProgress;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onUndo?: () => void;
}) {
  const t = useTranslations('campaigns.progress');
  const tp = useTranslations('campaigns.pauseReason');
  const format = useFormatter();
  const c = progress.counters;
  const pause = progress.pause_reason;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="progress-title">
      <div className="flex items-center gap-3">
        <h2 id="progress-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <StatusBadge status={progress.status} />
      </div>

      <Progress
        value={c.sent}
        max={Math.max(c.total, 1)}
        label={t('barLabel')}
        // Čtečka má číst „3 214 z 12 480", ne „26 procent".
        valueText={t('barValueText', {
          sent: format.number(c.sent),
          total: format.number(c.total),
        })}
      />

      {progress.undo_remaining_seconds > 0 && onUndo && (
        <UndoCountdown
          remainingSeconds={progress.undo_remaining_seconds}
          onUndo={onUndo}
          {...(onPause ? { onPause } : {})}
        />
      )}

      <dl className="grid gap-4 sm:grid-cols-2" data-testid="progress-tiles">
        <div data-testid="tile-sent">
          <dt className="font-medium">{t('sentLabel')}</dt>
          <dd className="text-2xl">{format.number(c.sent)}</dd>
          <p className="text-sm text-text-muted">{t('sentHint')}</p>
        </div>
        <div data-testid="tile-delivered">
          <dt className="font-medium">{t('deliveredLabel')}</dt>
          <dd className="text-2xl">{format.number(c.delivered)}</dd>
          <p className="text-sm text-text-muted">{t('deliveredHint')}</p>
        </div>
        <div data-testid="tile-bounced">
          <dt className="font-medium">{t('bouncedLabel')}</dt>
          <dd className="text-2xl">{format.number(c.bounced)}</dd>
          <p className="text-sm text-text-muted">{t('bouncedHint')}</p>
        </div>
        {progress.ambiguous_count > 0 && (
          <div data-testid="tile-ambiguous">
            {/* Nejisté odeslání je u SES běžný důsledek pádu, ne anomálie.
                Zobrazuje se jako samostatná kategorie, ne mezi selháními. */}
            <dt className="font-medium">{t('ambiguousLabel')}</dt>
            <dd className="text-2xl">{format.number(progress.ambiguous_count)}</dd>
            <p className="text-sm text-text-muted">{t('ambiguousHint')}</p>
          </div>
        )}
      </dl>

      {progress.stalled && <Alert tone="warning">{t('stalled')}</Alert>}

      {progress.status === 'paused' && pause && (
        <Alert
          tone={pause.code.endsWith('_guard') ? 'error' : 'warning'}
          data-testid="pause-box"
          title={t('paused')}
        >
          {/* Katalog musí pokrývat VŠECH DEVĚT kódů včetně čtyř od senderu. Kdyby
              pokrýval jen aplikační, kampaň zastavená senderem kvůli nedešifrovatelným
              přístupovým údajům by se zobrazila jako pauza bez důvodu. */}
          <p>{tp(PAUSE_KEY[pause.code] ?? 'user')}</p>
          <p>{t('stopped', { sent: format.number(c.sent), total: format.number(c.total) })}</p>
          {onResume && <Button onClick={onResume}>{t('resume')}</Button>}
        </Alert>
      )}

      {(progress.status === 'sending' || progress.status === 'queueing') && (
        <div className="flex gap-3">
          {onPause && <Button onClick={onPause}>{t('pause')}</Button>}
          {onCancel && (
            <Button variant="destructive" onClick={onCancel}>
              {t('cancel')}
            </Button>
          )}
          <p className="text-sm text-text-muted">{t('claimedNote')}</p>
        </div>
      )}
    </section>
  );
}
