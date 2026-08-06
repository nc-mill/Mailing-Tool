'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { IndeterminateProgress, Progress } from '@mlain/ui/components/progress';
import { Alert } from '@mlain/ui/patterns/states';
import { isFinishedCampaign } from './campaign-target';
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
  /**
   * Dorazila od poskytovatele aspoň jedna zpráva o doručení?
   *
   * Nula a „neměříme" jsou dvě různé věci. Dokud je tohle `false`, není
   * `delivered: 0` údaj, ale absence údaje, a obrazovka to musí říct. Ve vývoji
   * je to trvalý stav: odběr událostí u Amazonu se nepotvrdí, protože náš
   * webhook běží na `localhost`.
   *
   * Nepovinné kvůli starším odpovědím API: chybějící pole se chová jako
   * „neměříme", což je bezpečnější než tvrdit nulu.
   */
  delivery_events_seen?: boolean;
  /** Skončila rozesílka? Obrazovka podle toho přestane obnovovat. */
  finished?: boolean;
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
  onSendNow,
  releasing = false,
  actionFailed = false,
  reportHref,
}: {
  progress: CampaignProgress;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onUndo?: () => void;
  onSendNow?: () => void;
  releasing?: boolean;
  actionFailed?: boolean;
  reportHref?: string;
}) {
  const t = useTranslations('campaigns.progress');
  const tp = useTranslations('campaigns.pauseReason');
  const format = useFormatter();
  const c = progress.counters;
  const pause = progress.pause_reason;
  const finished = isFinishedCampaign(progress.status);

  /*
   * Doručenost se dozvíme JEDINĚ z událostí od poskytovatele. Dokud nedorazila
   * ani jedna, není správná odpověď nula, ale „zatím nevíme". Trvalá nula u
   * kampaně, která celá odešla, vypadá jako by nikomu nic nedošlo, a to je
   * tvrzení, které nemáme čím podložit.
   */
  const deliveryMeasured = progress.delivery_events_seen === true;

  /*
   * Publikum se ještě staví, takže celkový počet zatím není známý a jakýkoli
   * procentní pruh by ukazoval podíl z čísla, které se pod ním mění. Neurčitý
   * ukazatel řekne to jediné, co je pravda: pracuje se.
   */
  const preparing = progress.status === 'queueing' && c.total === 0;

  return (
    <section className="flex flex-col gap-[var(--spacing-gutter)]" aria-labelledby="progress-title">
      <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
        <h2
          id="progress-title"
          className="text-h3 font-semibold tracking-[var(--tracking-heading)] text-text"
        >
          {t('title')}
        </h2>
        <StatusBadge status={progress.status} />
      </div>

      {/* Dokud kampaň běží, je odkaz na report nenápadný. Jakmile dojede, je
          z něj pruh: obrazovka průběhu u dojeté kampaně nemá co nabídnout
          a bez odkazu by na ní uživatel zůstal viset. */}
      {reportHref === undefined ? null : finished ? (
        <Alert tone="success" data-testid="progress-to-report">
          <p>{t('finished')}</p>
          <p>
            <Link href={reportHref}>{t('toReport')}</Link>
          </p>
        </Alert>
      ) : (
        <p className="text-ui">
          <Link href={reportHref} data-testid="progress-to-report">
            {t('toReport')}
          </Link>
        </p>
      )}

      {preparing ? (
        <div className="flex flex-col gap-2">
          <IndeterminateProgress label={t('preparing')} />
          <p className="text-meta text-text-muted">{t('preparing')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
          {/* Totéž číslo i pro toho, kdo čtečku nepoužívá. Pruh u tříprvkové
              kampaně skáče po třetinách a bez popisku není poznat, jestli se
              hnul, nebo ne. */}
          <p className="font-mono text-meta text-text-muted" data-testid="progress-caption">
            {t('barValueText', {
              sent: format.number(c.sent),
              total: format.number(c.total),
            })}
            {progress.eta_seconds !== null && (
              <> {t('etaSeconds', { seconds: format.number(progress.eta_seconds) })}</>
            )}
          </p>
        </div>
      )}

      {progress.undo_remaining_seconds > 0 && onUndo && (
        <UndoCountdown
          remainingSeconds={progress.undo_remaining_seconds}
          onUndo={onUndo}
          releasing={releasing}
          {...(onSendNow ? { onSendNow } : {})}
          {...(onPause ? { onPause } : {})}
        />
      )}

      {actionFailed && <Alert tone="error">{t('actionFailed')}</Alert>}

      {/* Dlaždice s čísly. Skládají se z karty, mono verzálek a velkého čísla,
          stejně jako v reportu; komponenta to není schválně, každá obrazovka
          má v dlaždici něco jiného. */}
      <dl
        className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[var(--spacing-gutter)]"
        data-testid="progress-tiles"
      >
        <Card as="div" padding="md" gap="none" data-testid="tile-sent">
          <dt className="meta-caps text-text-muted">{t('sentLabel')}</dt>
          <dd className="mt-3 text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text">
            {format.number(c.sent)}
          </dd>
          <p className="mt-[var(--spacing-stack)] text-meta text-text-muted">{t('sentHint')}</p>
        </Card>
        <Card as="div" padding="md" gap="none" data-testid="tile-delivered">
          <dt className="meta-caps text-text-muted">{t('deliveredLabel')}</dt>
          <dd
            className={
              deliveryMeasured
                ? 'mt-3 text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text'
                : 'mt-3 text-lead text-text-muted'
            }
          >
            {deliveryMeasured ? format.number(c.delivered) : t('notMeasured')}
          </dd>
          <p className="mt-[var(--spacing-stack)] text-meta text-text-muted">
            {deliveryMeasured ? t('deliveredHint') : t('notMeasuredHint')}
          </p>
        </Card>
        <Card as="div" padding="md" gap="none" data-testid="tile-bounced">
          <dt className="meta-caps text-text-muted">{t('bouncedLabel')}</dt>
          <dd
            className={
              deliveryMeasured
                ? 'mt-3 text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text'
                : 'mt-3 text-lead text-text-muted'
            }
          >
            {deliveryMeasured ? format.number(c.bounced) : t('notMeasured')}
          </dd>
          <p className="mt-[var(--spacing-stack)] text-meta text-text-muted">
            {deliveryMeasured ? t('bouncedHint') : t('notMeasuredHint')}
          </p>
        </Card>
        {progress.ambiguous_count > 0 && (
          <Card as="div" padding="md" gap="none" data-testid="tile-ambiguous">
            {/* Nejisté odeslání je u SES běžný důsledek pádu, ne anomálie.
                Zobrazuje se jako samostatná kategorie, ne mezi selháními. */}
            <dt className="meta-caps text-text-muted">{t('ambiguousLabel')}</dt>
            <dd className="mt-3 text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text">
              {format.number(progress.ambiguous_count)}
            </dd>
            <p className="mt-[var(--spacing-stack)] text-meta text-text-muted">
              {t('ambiguousHint')}
            </p>
          </Card>
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
        <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
          {onPause && <Button onClick={onPause}>{t('pause')}</Button>}
          {onCancel && (
            <Button variant="destructive" onClick={onCancel}>
              {t('cancel')}
            </Button>
          )}
          <p className="text-meta text-text-muted">{t('claimedNote')}</p>
        </div>
      )}
    </section>
  );
}
