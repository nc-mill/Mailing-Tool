'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RefreshCw } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
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
      <>
        <PageHeader title={t('result.running')} />
        {workspaceId === undefined ? (
          <p className="text-ui text-text-muted">{t('result.runningRefresh')}</p>
        ) : (
          <StepProgress
            importId={row.id}
            workspaceId={workspaceId}
            locale={locale}
            onDone={() => router.refresh()}
          />
        )}
      </>
    );
  }

  /**
   * Stav, který obrazovka nezná (nový stav ze serveru, starší klient). Hlásí se jako
   * neznámý, ne jako selhání: o datech nevíme nic, takže se o nich nic netvrdí.
   */
  if (row.status === 'unknown') {
    return (
      <div role="alert">
        <PageHeader title={t('result.unknown')} />
        <div className="flex flex-col items-start gap-[var(--spacing-gutter)]">
          <p className="text-ui text-text">
            {t('result.unknownNextStep', { status: row.rawStatus ?? '?' })}
          </p>
          <Button variant="secondary" onClick={() => router.refresh()}>
            <RefreshCw aria-hidden className="icon-sm" />
            {t('result.refresh')}
          </Button>
          <a href={`/w/${workspaceSlug}/contacts?source_ref=${row.id}`} className="text-ui">
            {t('result.showImported')}
          </a>
        </div>
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
    <>
      <PageHeader title={heading} />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {row.status === 'failed' ? (
          <Alert tone="error">
            <p>{t('result.failedNothingWritten')}</p>
            {row.failureDetail !== null ? (
              <details>
                <summary className="cursor-pointer text-meta">{t('result.supportDetails')}</summary>
                {/* Technický detail pro podporu se čte po znacích a nesmí
                    rozšířit stránku, proto mono a vlastní posuv. */}
                <pre className="mt-1.5 overflow-x-auto rounded-[var(--radius-control)] bg-surface p-[var(--spacing-inline)] font-mono text-meta text-text">
                  {row.failureDetail}
                </pre>
              </details>
            ) : null}
          </Alert>
        ) : null}

        {/* Rozpad výsledku na čtyři čísla. Dlaždice, ne definiční seznam: čísla
            se porovnávají mezi sebou a v řádku textu zanikají. Popisek je mono
            verzálkami nad číslem, stejně jako na Přehledu. */}
        {row.status !== 'failed' ? (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[var(--spacing-gutter)]">
            {(
              [
                ['created', row.createdRows, 'plain'],
                ['updated', row.updatedRows, 'plain'],
                ['suppressed', row.suppressedRows, 'plain'],
                // Chybné řádky jsou to jediné, co žádá akci, takže tlumená
                // plocha navíc, ne barevný poplach: import proběhl.
                ['failed', row.errorRows, row.errorRows > 0 ? 'muted' : 'plain'],
              ] as const
            ).map(([key, count, tone]) => (
              <Card key={key} as="div" tone={tone} padding="md" gap="none">
                <dt className="meta-caps text-text-muted">{t(`result.breakdown.${key}`)}</dt>
                <dd className="text-display leading-[var(--leading-number)] font-semibold tracking-[var(--tracking-number)] text-text">
                  {n(count)}
                </dd>
              </Card>
            ))}
          </dl>
        ) : null}

        {warnings.length > 0 ? (
          <Card as="section" tone="muted" padding="sm">
            <CardTitle as="h2">{t('result.guessedSection')}</CardTitle>
            <p className="text-ui text-text">
              {t('result.guessedIntro', {
                count: n(warnings.reduce((sum, code) => sum + (row.errorSummary[code] ?? 0), 0)),
              })}
            </p>
            <ul className="flex flex-col gap-[var(--spacing-inline)]">
              {/* Varování s nulou se NEZOBRAZUJE. Řádek „0 jmen se nepodařilo
                  rozdělit" je šum, ve kterém zanikne to, co se opravdu stalo. */}
              {warnings.map((code) => (
                <li
                  key={code}
                  className="flex flex-wrap items-center gap-[var(--spacing-inline)] text-ui text-text"
                >
                  {t(`warnings.${code}`, { n: n(row.errorSummary[code] ?? 0), interpretation: '' })}
                  <Button variant="link">{t('result.guessedShow')}</Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* Cesty dál. Stažení chyb a obnovení zrušeného importu jsou akce,
            zbytek jsou odkazy, takže to nesplývá do řady stejných tlačítek. */}
        <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
          {row.errorRows > 0 ? (
            <a href={`/api/v1/contacts/imports/${row.id}/errors.csv`} download className="text-ui">
              {t('result.downloadErrors', { count: row.errorRows })}
            </a>
          ) : null}

          {row.status === 'cancelled' ? (
            <Button variant="secondary" size="sm">
              {t('result.resume', { row: n(row.checkpointRow + 1) })}
            </Button>
          ) : null}

          {greetingEnabled && row.reviewRows > 0 ? (
            <a
              href={`/w/${workspaceSlug}/contacts/vocative-review?import_id=${row.id}`}
              className="text-ui"
            >
              {t('result.reviewVocative')}
            </a>
          ) : null}

          {/* Náhrada za „vrátit tento import", který v MVP 0 není (rozhodnutí R5).
              Mrtvé tlačítko Undo by slibovalo něco, co datový model neumí. */}
          <a href={`/w/${workspaceSlug}/contacts?source_ref=${row.id}`} className="text-ui">
            {t('result.showImported')}
          </a>

          <a href={`/w/${workspaceSlug}/contacts/import`} className="text-ui">
            {t('result.uploadAnother')}
          </a>
        </div>
      </div>
    </>
  );
}
