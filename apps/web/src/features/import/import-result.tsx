'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { formatCount, WARNING_CODES } from './labels';
import type { ImportResultStatus } from './result-status';
import { StepProgress } from './step-progress';

export type ImportResultRow = {
  id: string;
  status: ImportResultStatus;
  /** Stav tak, jak ho vrátil server. Ukazuje se u neznámého stavu, ať je co nahlásit. */
  rawStatus?: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  suppressedRows: number;
  errorRows: number;
  checkpointRow: number;
  reviewRows: number;
  errorSummary: Record<string, number>;
  failureDetail: string | null;
};

/**
 * Čtyři stavy výsledku. Rozlišit `failed` od `completed_with_errors` je
 * nejdůležitější: první znamená, že se nezapsalo NIC, druhý že se zapsala
 * většina. Kdo si to splete, buď importuje podruhé, nebo si myslí, že má
 * data, a nemá. Proto jiný nadpis, ne jiná barva.
 */
export function ImportResult({
  row,
  workspaceSlug,
  workspaceId,
  locale = 'cs',
  greetingEnabled = true,
}: {
  row: ImportResultRow;
  workspaceSlug: string;
  /** Bez reference na projekt nejde otevřít proud s průběhem; pak se jen nabídne obnovení. */
  workspaceId?: string;
  locale?: string;
  /**
   * Řeší projekt oslovení a 5. pád? Vypnuto skryje odkaz „Zkontrolovat 5. pád":
   * obrazovka, na kterou míří, v takovém projektu vrací 404. Výchozí `true` je
   * kvůli starším testům.
   */
  greetingEnabled?: boolean;
}) {
  const t = useTranslations('import');
  const router = useRouter();
  const n = (value: number) => formatCount(value, locale);

  /**
   * Běžící import: ukáže se PRŮBĚH, tentýž, jaký ukazuje poslední krok průvodce.
   * Až doběhne, stránka se načte znovu a vypíše skutečný výsledek. Žádné tvrzení
   * o tom, jak import dopadl, tady padnout nesmí, protože ještě nedopadl nijak.
   */
  if (row.status === 'running') {
    return (
      <div className="flex flex-col gap-4">
        <h1>{t('result.running')}</h1>
        {workspaceId === undefined ? (
          <p>{t('result.runningRefresh')}</p>
        ) : (
          <StepProgress
            importId={row.id}
            workspaceId={workspaceId}
            locale={locale}
            onDone={() => router.refresh()}
          />
        )}
      </div>
    );
  }

  /**
   * Stav, který obrazovka nezná (nový stav ze serveru, starší klient). Hlásí se jako
   * neznámý, ne jako selhání: o datech nevíme nic, takže se o nich nic netvrdí.
   */
  if (row.status === 'unknown') {
    return (
      <div className="flex flex-col gap-4" role="alert">
        <h1>{t('result.unknown')}</h1>
        <p>{t('result.unknownNextStep', { status: row.rawStatus ?? '?' })}</p>
        <button type="button" onClick={() => router.refresh()}>
          {t('result.refresh')}
        </button>
        <a href={`/w/${workspaceSlug}/contacts?source_ref=${row.id}`}>{t('result.showImported')}</a>
      </div>
    );
  }

  const heading =
    row.status === 'completed'
      ? t('result.completed', { count: row.createdRows + row.updatedRows })
      : row.status === 'completed_with_errors'
        ? t('result.withErrors', {
            done: n(row.createdRows + row.updatedRows),
            total: n(row.totalRows),
          })
        : row.status === 'cancelled'
          ? t('result.cancelled', { row: n(row.checkpointRow) })
          : t('result.failed');

  const warnings = WARNING_CODES.filter((code) => (row.errorSummary[code] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <h1>{heading}</h1>

      {row.status === 'failed' ? (
        <>
          <p>{t('result.failedNothingWritten')}</p>
          {row.failureDetail !== null ? (
            <details>
              <summary>{t('result.supportDetails')}</summary>
              <pre>{row.failureDetail}</pre>
            </details>
          ) : null}
        </>
      ) : null}

      {row.status !== 'failed' ? (
        <dl>
          <dt>{t('result.breakdown.created')}</dt>
          <dd>{n(row.createdRows)}</dd>
          <dt>{t('result.breakdown.updated')}</dt>
          <dd>{n(row.updatedRows)}</dd>
          <dt>{t('result.breakdown.suppressed')}</dt>
          <dd>{n(row.suppressedRows)}</dd>
          <dt>{t('result.breakdown.failed')}</dt>
          <dd>{n(row.errorRows)}</dd>
        </dl>
      ) : null}

      {warnings.length > 0 ? (
        <section>
          <h2>{t('result.guessedSection')}</h2>
          <p>
            {t('result.guessedIntro', {
              count: n(warnings.reduce((sum, code) => sum + (row.errorSummary[code] ?? 0), 0)),
            })}
          </p>
          <ul>
            {/* Varování s nulou se NEZOBRAZUJE. Řádek „0 jmen se nepodařilo
                rozdělit" je šum, ve kterém zanikne to, co se opravdu stalo. */}
            {warnings.map((code) => (
              <li key={code}>
                {t(`warnings.${code}`, { n: n(row.errorSummary[code] ?? 0), interpretation: '' })}
                <button type="button">{t('result.guessedShow')}</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {row.errorRows > 0 ? (
        <a href={`/api/v1/contacts/imports/${row.id}/errors.csv`} download>
          {t('result.downloadErrors', { count: row.errorRows })}
        </a>
      ) : null}

      {row.status === 'cancelled' ? (
        <button type="button">{t('result.resume', { row: n(row.checkpointRow + 1) })}</button>
      ) : null}

      {greetingEnabled && row.reviewRows > 0 ? (
        <a href={`/w/${workspaceSlug}/contacts/vocative-review?import_id=${row.id}`}>
          {t('result.reviewVocative')}
        </a>
      ) : null}

      {/* Náhrada za „vrátit tento import", který v MVP 0 není (rozhodnutí R5).
          Mrtvé tlačítko Undo by slibovalo něco, co datový model neumí. */}
      <a href={`/w/${workspaceSlug}/contacts?source_ref=${row.id}`}>{t('result.showImported')}</a>

      <a href={`/w/${workspaceSlug}/contacts/import`}>{t('result.uploadAnother')}</a>
    </div>
  );
}
