'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { formatCount } from './labels';

export type Progress = { processed: number; total: number | null; status: string };

const MILESTONES = [25, 50, 75, 100];

/**
 * Krok 6. Průběh přes SSE, po třech neúspěších přechod na dotazování.
 *
 * Do `aria-live` se hlásí jen 25, 50, 75 a 100 procent. Čtečka, která předčítá
 * každou změnu čísla, je horší než žádné hlášení: uživatel ji vypne a přijde
 * i o oznámení konce.
 */
export function StepProgress({
  importId,
  workspaceId,
  locale = 'cs',
  initial,
  onDone,
}: {
  importId: string;
  workspaceId: string;
  locale?: string;
  initial?: Progress;
  onDone?: (status: string) => void;
}) {
  const t = useTranslations('import');
  const [progress, setProgress] = useState<Progress>(
    initial ?? { processed: 0, total: null, status: 'importing' },
  );
  const [degraded, setDegraded] = useState(false);
  const [announced, setAnnounced] = useState<string>('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const reached = useRef(new Set<number>());

  useEffect(() => {
    let failures = 0;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const apply = (next: Progress) => {
      setProgress(next);
      if (next.total !== null && next.total > 0) {
        const percent = Math.floor((next.processed / next.total) * 100);
        for (const milestone of MILESTONES) {
          if (percent >= milestone && !reached.current.has(milestone)) {
            reached.current.add(milestone);
            setAnnounced(`${milestone} %`);
          }
        }
      }
    };

    const startPolling = () => {
      setDegraded(true);
      poll = setInterval(() => {
        void fetch(`/api/v1/contacts/imports/${importId}`, {
          headers: { 'X-Workspace-Id': workspaceId },
        })
          .then((res) => res.json())
          .then((row: { checkpoint_row: number; total_rows: number | null; status: string }) => {
            apply({ processed: row.checkpoint_row, total: row.total_rows, status: row.status });
          })
          .catch(() => undefined);
      }, 5000);
    };

    const connect = () => {
      source = new EventSource(`/api/v1/contacts/imports/${importId}/events`);
      source.addEventListener('progress', (event) => {
        failures = 0;
        const data = JSON.parse((event as MessageEvent<string>).data) as Progress & {
          terminal: boolean;
        };
        apply(data);
        if (data.terminal) {
          source?.close();
          onDone?.(data.status);
        }
      });
      source.addEventListener('error', () => {
        failures += 1;
        source?.close();
        // Tři pokusy, pak dotazování. Nekonečné znovupřipojování vypadá
        // navenek stejně jako zaseknutý import, což je nejhorší možný stav.
        if (failures >= 3) startPolling();
        else connect();
      });
    };

    connect();
    return () => {
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [importId, onDone, workspaceId]);

  const total = progress.total ?? 0;
  const rest = Math.max(total - progress.processed, 0);

  return (
    <div className="flex flex-col gap-4">
      <h2>{t('progress.title')}</h2>

      <div
        role="progressbar"
        aria-valuenow={progress.processed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={t('progress.counter', {
          processed: formatCount(progress.processed, locale),
          total: formatCount(total, locale),
        })}
      />

      <p>
        {t('progress.counter', {
          processed: formatCount(progress.processed, locale),
          total: formatCount(total, locale),
        })}
      </p>

      <p role="status" aria-live="polite">
        {announced}
      </p>

      <p>{t('progress.runsOnServer')}</p>
      {degraded ? <p>{t('progress.liveUpdatesFailed')}</p> : null}

      <button type="button" onClick={() => setConfirmCancel(true)}>
        {t('progress.cancel')}
      </button>

      {confirmCancel ? (
        <div role="dialog" aria-label={t('progress.cancelConfirmTitle')}>
          <strong>{t('progress.cancelConfirmTitle')}</strong>
          <p>
            {t('progress.cancelConfirmBody', {
              done: formatCount(progress.processed, locale),
              rest: formatCount(rest, locale),
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              void fetch(`/api/v1/contacts/imports/${importId}/cancel`, {
                method: 'POST',
                headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
              });
              setConfirmCancel(false);
            }}
          >
            {t('progress.cancelConfirm')}
          </button>
          <button type="button" onClick={() => setConfirmCancel(false)}>
            {t('progress.cancelDismiss')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
