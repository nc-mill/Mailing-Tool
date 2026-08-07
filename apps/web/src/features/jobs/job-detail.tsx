'use client';

import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Progress } from '@mlain/ui/components/progress';
import { ArrowLeft } from '@mlain/ui/icons';
import { Link } from '@mlain/i18n/navigation';
import { UNFINISHED_STATUSES } from '@mlain/ui/patterns/jobs';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { useState } from 'react';
import { CancelJobButton, useCancelResultMessage } from './cancel-job-button';
import { jobKindKey, jobSourceLink, jobStatusKey, jobStatusTone, type ApiJob } from './job-view';

/**
 * Detail jedné úlohy, tedy cíl odkazu „Otevřít" ze seznamu (dřívější nález N30).
 * Bez téhle obrazovky byl každý řádek Centra úloh slepý odkaz.
 *
 * OBRAZOVKA NIC NEDOTAZUJE. Úlohy trvají minuty a na detail se člověk dívá
 * chvíli; obnovování řeší seznam, kde je pruh průběhu u všech úloh najednou
 * (zdůvodnění v `refresh.ts`). Kdo chce vidět postup živě, má u importu i
 * u kampaně vlastní obrazovku průběhu, na kterou odsud vede odkaz.
 */
export function JobDetail({
  job,
  workspaceSlug,
  workspaceId,
}: {
  job: ApiJob;
  workspaceSlug: string;
  workspaceId: string;
}) {
  const t = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const cancelResultMessage = useCancelResultMessage();
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  // Pruh průběhu patří k NEDOKONČENÉ práci, ne jen k běžící: u pozastavené
  // kampaně je „kolik už odešlo" ta informace, kvůli které se sem chodí.
  const unfinished = UNFINISHED_STATUSES.includes(job.status);
  const source = jobSourceLink(job, workspaceSlug);
  // Popisek bere v potaz `stopping`: dokud dobíhá dávka, není to „Zrušeno".
  const statusLabel = t(jobStatusKey(job));
  // `dateTime`, ne `short`: u úlohy, která běžela dvacet minut, je čas ta
  // informace, kvůli které se na detail chodí. Samotné datum nerozliší ani
  // dva importy téhož souboru z jednoho dopoledne.
  const dateTime = (value: string) => format.dateTime(new Date(value), 'dateTime');
  /*
   * Postup s ODDĚLOVAČEM TISÍCŮ. Klíč `jobs.progressOf` dostával holá čísla,
   * takže tu stálo „1240 z 5000", kdežto potvrzovací okno zastavení hned vedle
   * psalo „1 240 z 5 000". U importu o statisících řádků není rozdíl mezi
   * 12 400 a 124 000 bez oddělovače na jeden pohled poznat.
   */
  const progress = (done: number, total: number) =>
    t('jobs.progressOf', { done: format.number(done), total: format.number(total) });

  return (
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      <PageHeader
        breadcrumbs={
          <Button asChild variant="link">
            <Link href={`/w/${workspaceSlug}/jobs`}>
              <ArrowLeft aria-hidden className="icon-sm" />
              {t('jobs.backToList')}
            </Link>
          </Button>
        }
        eyebrow={t(jobKindKey(job.kind))}
        title={job.title}
        titleGap="lg"
        meta={<Badge tone={jobStatusTone(job.status)}>{statusLabel}</Badge>}
        actions={
          <>
            {source ? (
              <Button asChild variant="primary">
                <Link href={source.href}>{t(source.labelKey)}</Link>
              </Button>
            ) : null}
            {/* Zastavení je tu ve stejné podobě jako v seznamu, jen větší:
                na detail se chodí právě proto, aby se s úlohou dalo něco
                udělat. Úloha, která zastavit nejde, tlačítko nedostane. */}
            <CancelJobButton
              job={job}
              workspaceId={workspaceId}
              size="md"
              onResult={(result) => {
                setCancelMessage(cancelResultMessage(result));
                // Detail nic nedotazuje (viz komentář výš), takže se čerstvý
                // stav bere obnovením serverové části stránky.
                router.refresh();
              }}
            />
          </>
        }
      />

      {cancelMessage ? (
        <p role="status" aria-live="polite" className="text-ui text-text">
          {cancelMessage}
        </p>
      ) : null}

      <Card padding="lg" gap="gutter">
        {/* Dokud dobíhá rozepsaná dávka, čísla níž ještě nejsou konečná.
            Bez téhle věty by odznak „Zastavuje se" nikdo nevysvětlil. */}
        {job.stopping ? <p className="text-ui text-text">{t('jobs.stoppingNote')}</p> : null}

        {/* Pruh průběhu jen u toho, co běží. U dokončené úlohy je pruh na 100 %
            jen ozdoba a u zrušené přímo lže: 4 987 z 5 000 znamená, že zbytek
            se nikdy nezpracuje, ne že chybí kousek. */}
        {unfinished ? (
          <div className="flex flex-col gap-[var(--spacing-stack)]">
            <Progress
              value={job.done}
              max={job.total}
              label={job.title}
              valueText={progress(job.done, job.total)}
            />
            <p className="font-mono text-meta text-text-muted">
              {job.total > 0 ? progress(job.done, job.total) : t('jobs.unknownTotal')}
            </p>
          </div>
        ) : null}

        <dl className="grid gap-[var(--spacing-stack)] sm:grid-cols-2">
          <DetailRow label={t('jobs.statusLabel')} value={statusLabel} />
          <DetailRow
            label={t('jobs.progressLabel')}
            value={job.total > 0 ? progress(job.done, job.total) : format.number(job.done)}
          />
          {/* Systémovou úlohu nikdo nespustil, takže tam nepatří jméno ani
              prázdno, ale slovo „Systém" (pravidlo 5.7). */}
          <DetailRow
            label={t('jobs.startedByLabel')}
            value={job.started_by ?? t('jobs.startedBySystem')}
          />
          <DetailRow label={t('jobs.startedAtLabel')} value={dateTime(job.started_at)} />
          <DetailRow label={t('jobs.updatedAtLabel')} value={dateTime(job.updated_at)} />
          {job.finished_at ? (
            <DetailRow label={t('jobs.finishedAtLabel')} value={dateTime(job.finished_at)} />
          ) : null}
          {job.note ? <DetailRow label={t('jobs.failureCodeLabel')} value={job.note} /> : null}
        </dl>
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm font-medium text-text">{label}</dt>
      <dd className="text-sm text-text-muted">{value}</dd>
    </div>
  );
}
