'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog, type ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';
import type { ApiJob, JobCancelResponse } from './job-view';

/**
 * ZASTAVENÍ ÚLOHY Z CENTRA ÚLOH.
 *
 * TLAČÍTKO SE BUĎ ZOBRAZÍ, NEBO NEZOBRAZÍ. Třetí možnost, tedy zašedlé tlačítko
 * bez vysvětlení, v tomhle projektu není. Rozhoduje `can_cancel` z API, protože
 * jedině zdroj úlohy ví, jestli má běh kam přepnout stav: import se z fáze
 * počítání řádků zrušit nedá, doběhlá úloha se nedá zrušit zpětně.
 *
 * ZASTAVENÍ JE SPOLUPRÁCE, NE ZABITÍ. Obě dnešní úlohy se na zrušení ptají mezi
 * dávkami, takže mezi kliknutím a skutečným koncem je prodleva. Tlačítko proto
 * nikdy nehlásí „zastaveno": vrací `outcome`, který volající vypíše slovy,
 * a řádek si drží větu o dobíhající dávce, dokud API hlásí `stopping`.
 */

export type JobCancelResult =
  | { kind: 'ok'; outcome: JobCancelResponse['outcome']; job: ApiJob }
  | { kind: 'error'; detail: string };

/**
 * Popisky potvrzovacího okna z OBECNÉHO katalogu, ne z Centra úloh. Tvar je
 * daný návrhovým systémem; kdyby si je obrazovka psala po svém, rozešla by se
 * věta o nevratnosti se zbytkem aplikace.
 */
function useConfirmLabels(identifier: string): ConfirmDialogLabels {
  const t = useTranslations('common.confirm');
  return {
    irreversible: t('irreversible'),
    whatHappens: t('whatHappens'),
    notYetConfirmed: t('notYetConfirmed'),
    notYetTyped: t('notYetTyped', { identifier }),
    typeToConfirmMismatch: t('typeToConfirmMismatch'),
    filterInWords: (filter: string) => t('filterInWords', { filter }),
  };
}

/**
 * SAMOTNÉ POTVRZOVACÍ OKNO, oddělené od spouštěče.
 *
 * PROČ ODDĚLENĚ, a je to poučení, které v projektu už jednou stálo vadu:
 * v tabulce spouští zastavení POLOŽKA ROZBALENÉ NABÍDKY, a obsah nabídky se
 * při volbě položky odpojí z DOM. Kdyby okno bydlelo uvnitř, odešlo by
 * s nabídkou dřív, než by se stihlo ukázat. Otevření proto drží tabulka
 * a sem chodí jen `open`, přesně jako u seznamů (`lists-table.tsx`).
 *
 * Detail úlohy má spouštěč jako obyčejné tlačítko, tam ten problém není,
 * a používá `CancelJobButton` níž, který si okno drží sám.
 */
export function JobCancelDialog({
  job,
  workspaceId,
  open,
  onOpenChange,
  onResult,
}: {
  job: ApiJob;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Výsledek hlásí VOLAJÍCÍ, na jednom místě obrazovky. Řádek na to místo není. */
  onResult: (result: JobCancelResult) => void;
}) {
  const t = useTranslations('common');
  const format = useFormatter();
  const labels = useConfirmLabels(job.title);
  const [pending, setPending] = useState(false);

  const setOpen = onOpenChange;

  async function confirm() {
    // Dvojklik na potvrzení nesmí poslat dva požadavky. Server je sice zvládne
    // (druhý vrátí `already_cancelled`), ale uživatel by dostal dvě hlášky.
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(
        `/api/v1/jobs/${encodeURIComponent(job.kind)}/${encodeURIComponent(job.id)}/cancel`,
        {
          method: 'POST',
          headers: { 'X-Workspace-Id': workspaceId, accept: 'application/json' },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as JobCancelResponse;
      onResult({ kind: 'ok', outcome: body.outcome, job: body.job });
      setOpen(false);
    } catch (err) {
      // Okno se zavírá i při chybě: hláška patří na obrazovku, kde ji uživatel
      // uvidí i po zavření, ne do okna, které zmizí s prvním kliknutím vedle.
      onResult({ kind: 'error', detail: err instanceof Error ? err.message : 'unknown' });
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  const isCampaign = job.kind === 'campaign_audience';
  const counts = {
    done: format.number(job.done),
    total: format.number(job.total),
  };

  return (
    <>
      {isCampaign ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          /**
           * N3, tedy okno se zaškrtávátkem. Osy z 6.1: rozsah 2 (celé publikum),
           * obnovitelnost 2 (`cancelled` je koncový stav kampaně), vnější dopad 1
           * (odchozí pošta se zastaví dřív, než odejde). Opisování názvu (N4) tu
           * schválně není: tatáž akce se na obrazovce kampaně potvrzuje jedním
           * oknem a Centrum úloh nemá být přísnější než domovská obrazovka.
           */
          level="N3"
          // Připravené zprávy z fronty zmizí a kampaň se znovu rozjet nedá.
          destructive
          title={t('jobs.cancelCampaignTitle', { name: job.title })}
          consequences={[
            t('jobs.cancelCampaignWhole'),
            t('jobs.cancelCampaignQueued'),
            t('jobs.cancelCampaignCopy'),
          ]}
          acknowledgement={t('jobs.cancelCampaignAck')}
          confirmLabel={t('jobs.cancelCampaignConfirm')}
          cancelLabel={t('actions.keepRunning')}
          labels={labels}
          onConfirm={confirm}
        />
      ) : (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          /**
           * N2: rozsah 2, obnovitelnost 1 (zapsané kontakty v projektu zůstanou
           * a soubor se dá naimportovat znovu), vnější dopad 0. Okno s následky
           * stačí, zaškrtávátko by tu bylo jen tření navíc.
           *
           * `destructive` je FALSE: nic z projektu nezmizí a ven nic neodejde.
           * Kdyby červeně svítilo i tohle, přestala by červená rozlišovat mazání.
           */
          level="N2"
          destructive={false}
          title={t('jobs.cancelImportTitle', { name: job.title })}
          consequences={[
            // Nejdřív to, CO ZŮSTANE. „Opravdu zrušit?" bez tohohle řádku nutí
            // člověka hádat, jestli přijde i o už naimportované kontakty.
            job.done > 0 ? t('jobs.cancelImportKept', counts) : t('jobs.cancelImportNothingYet'),
            t('jobs.cancelImportRest'),
            t('jobs.cancelImportBatch'),
          ]}
          confirmLabel={t('jobs.cancelImportConfirm')}
          cancelLabel={t('actions.keepRunning')}
          labels={labels}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

/**
 * ZASTAVENÍ ÚLOHY TLAČÍTKEM. Používá ho detail úlohy, kde je spouštěč obyčejné
 * tlačítko a okno u něj klidně může bydlet. Seznam ho nepoužívá: tam spouští
 * zastavení položka nabídky, a ta se při volbě odpojí i s oknem, viz výš.
 *
 * TLAČÍTKO SE BUĎ ZOBRAZÍ, NEBO NEZOBRAZÍ. Třetí možnost, tedy zašedlé tlačítko
 * bez vysvětlení, v tomhle projektu není.
 */
export function CancelJobButton({
  job,
  workspaceId,
  onResult,
  size = 'sm',
}: {
  job: ApiJob;
  workspaceId: string;
  onResult: (result: JobCancelResult) => void;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  if (!job.can_cancel) return null;

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => setOpen(true)}
        data-testid={`cancel-job-${job.kind}`}
      >
        {t(job.kind === 'campaign_audience' ? 'jobs.cancelCampaign' : 'jobs.cancelImport')}
      </Button>
      <JobCancelDialog
        job={job}
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
        onResult={onResult}
      />
    </>
  );
}

/** Věta o výsledku. Je jedna pro seznam i detail, aby se ty dvě nerozešly. */
export function useCancelResultMessage(): (result: JobCancelResult) => string {
  const t = useTranslations('common');
  return (result) => {
    if (result.kind === 'error') return t('jobs.cancelFailed', { detail: result.detail });
    switch (result.outcome) {
      case 'cancelling':
        return t('jobs.cancelRequested');
      case 'already_cancelled':
        return t('jobs.cancelAlreadyCancelled');
      default:
        return t('jobs.cancelAlreadyFinished');
    }
  };
}
