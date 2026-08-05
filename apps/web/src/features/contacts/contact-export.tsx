'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';
import { createContactExportAction, exportStatusAction } from './actions';
import type { AudienceOutcome, ExportAudience } from './export-audience';

/** Dokud worker soubor nesloží, není co stáhnout. Ptáme se každou vteřinu a půl, nejvýš minutu. */
const POLL_MS = 1500;
const POLL_ATTEMPTS = 40;

type Phase =
  | { kind: 'preparing' }
  | { kind: 'ready'; href: string; rowCount: number | null }
  | { kind: 'slow'; href: string }
  | { kind: 'failed'; reason: 'server' | 'search' | 'too_many' | 'empty' | 'partial' };

type ExportState = { title: string; fileName: string; phase: Phase } | null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Založí export a počká, až ho worker dopíše. Vrací odkaz ke stažení, nebo důvod,
 * proč se nedočkala. Používá ji jak dialog s tlačítkem, tak dialog mazání, který
 * na hotový soubor čeká uvnitř sebe.
 */
async function runExport(input: {
  workspaceId: string;
  locale: string;
  audience: ExportAudience;
}): Promise<
  { ok: true; href: string; rowCount: number | null } | { ok: false; slowHref?: string }
> {
  const created = await createContactExportAction({
    workspaceId: input.workspaceId,
    audience: input.audience,
    locale: input.locale,
  });
  if (created.status !== 'success') return { ok: false };

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await wait(POLL_MS);
    const status = await exportStatusAction({ workspaceId: input.workspaceId, id: created.id });
    if (status.status !== 'success' || status.state === 'failed') return { ok: false };
    if (status.state === 'completed') {
      return { ok: true, href: created.downloadUrl, rowCount: status.rowCount };
    }
  }
  return { ok: false, slowHref: created.downloadUrl };
}

/**
 * Stažení hotového souboru.
 *
 * OBYČEJNÝ ODKAZ TU BÝT NEMŮŽE, a je to naměřené: `GET /contacts/exports/{id}/download`
 * bere projekt z hlavičky `X-Workspace-Id` a `<a href>` žádnou hlavičku poslat neumí,
 * takže odkaz padal na 404 i s platným tokenem. Stahuje se proto `fetch` s hlavičkou
 * a soubor se podá jako blob, stejně jako u mazání příloh a nahrávání importu.
 */
async function fetchToDisk(workspaceId: string, href: string, fileName: string): Promise<boolean> {
  const response = await fetch(href, {
    headers: { 'X-Workspace-Id': workspaceId },
    credentials: 'same-origin',
  });
  if (!response.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  // Z názvu se vyhazuje jen to, co by v názvu souboru vadilo. Tečka a zavináč
  // zůstávají, jinak by se z „novak@daend.cz" stalo nečitelné „novakdaendcz".
  anchor.download = `${fileName.replace(/[^\p{L}\p{N} _.@-]/gu, '')}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Export bez vlastního dialogu: založí, počká a rovnou stáhne. Je pro místa,
 * která si čekání hlásí sama, tedy dnes pro dialog hromadného mazání, kde je
 * export pojistkou před nevratnou akcí a druhé okno nad dialogem by překáželo.
 */
export async function exportAndDownload(input: {
  workspaceId: string;
  locale: string;
  outcome: AudienceOutcome;
  fileName: string;
}): Promise<{ status: 'success' | 'error' }> {
  if (!input.outcome.ok) return { status: 'error' };
  const finished = await runExport({
    workspaceId: input.workspaceId,
    locale: input.locale,
    audience: input.outcome.audience,
  });
  if (!finished.ok) return { status: 'error' };
  const downloaded = await fetchToDisk(input.workspaceId, finished.href, input.fileName);
  return { status: downloaded ? 'success' : 'error' };
}

/**
 * Export kontaktů od založení až po stažený soubor.
 *
 * JE TO JEDNO MÍSTO PRO CELOU DOMÉNU, protože všechna tři místa, odkud se
 * exportuje (seznam kontaktů, detail kontaktu, štítky), potřebují přesně tentýž
 * sled: založit export, počkat na worker, stáhnout soubor s hlavičkou projektu.
 * Rozkopírované by to znamenalo tři různě rozbité verze, což je přesně stav,
 * ve kterém byla doména do 5. 8. 2026.
 */
export function useContactExport(workspaceId: string) {
  const locale = useLocale();
  const [state, setState] = useState<ExportState>(null);
  /** Rozeznává běhy: po zavření dialogu už předchozí dotazování nic nepřepíše. */
  const run = useRef(0);

  function close() {
    run.current += 1;
    setState(null);
  }

  /**
   * Spustí export. `outcome` smí být i odmítnutí z `export-audience.ts`: dialog
   * pak vysvětlí, PROČ to nejde a co udělat místo toho, místo aby se nestalo nic.
   */
  async function start(input: {
    title: string;
    fileName: string;
    outcome: AudienceOutcome | { ok: true; audience: ExportAudience };
  }) {
    const current = run.current + 1;
    run.current = current;

    if (!input.outcome.ok) {
      setState({
        title: input.title,
        fileName: input.fileName,
        phase: { kind: 'failed', reason: input.outcome.reason },
      });
      return;
    }

    setState({ title: input.title, fileName: input.fileName, phase: { kind: 'preparing' } });
    const finished = await runExport({
      workspaceId,
      locale,
      audience: input.outcome.audience,
    });
    if (run.current !== current) return;

    setState({
      title: input.title,
      fileName: input.fileName,
      phase: finished.ok
        ? { kind: 'ready', href: finished.href, rowCount: finished.rowCount }
        : finished.slowHref === undefined
          ? { kind: 'failed', reason: 'server' }
          : { kind: 'slow', href: finished.slowHref },
    });
  }

  /**
   * Stažení hotového souboru.
   *
   * OBYČEJNÝ ODKAZ TU BÝT NEMŮŽE, a je to naměřené: `GET /contacts/exports/{id}/download`
   * bere projekt z hlavičky `X-Workspace-Id` a `<a href>` žádnou hlavičku poslat neumí,
   * takže odkaz padal na 404 i s platným tokenem. Stahuje se proto `fetch` s hlavičkou
   * a soubor se podá jako blob, stejně jako u mazání příloh a nahrávání importu.
   */
  async function download(href: string, fileName: string) {
    if (await fetchToDisk(workspaceId, href, fileName)) {
      close();
      return;
    }
    setState((previous) =>
      previous === null ? null : { ...previous, phase: { kind: 'failed', reason: 'server' } },
    );
  }

  return { state, start, download, close };
}

export function ContactExportDialog({
  state,
  onDownload,
  onClose,
}: {
  state: ExportState;
  onDownload: (href: string, fileName: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contacts');
  const phase = state?.phase;

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogTitle>{state?.title ?? t('export.title')}</DialogTitle>
      <DialogBody>
        {phase?.kind === 'preparing' ? <p>{t('export.preparing')}</p> : null}
        {phase?.kind === 'ready' ? (
          <p>
            {/* Skutečný počet řádků, ne odhad. Server ho vrací v `row_count`,
                takže se dá porovnat se seznamem dřív, než člověk soubor otevře. */}
            {phase.rowCount === null
              ? t('export.ready')
              : t('export.readyWithCount', { count: phase.rowCount })}
          </p>
        ) : null}
        {phase?.kind === 'slow' ? <p>{t('export.slow')}</p> : null}
        {phase?.kind === 'failed' ? (
          <Alert
            tone="error"
            title={
              phase.reason === 'search'
                ? t('export.failedSearch')
                : phase.reason === 'too_many'
                  ? t('export.failedTooMany')
                  : phase.reason === 'partial'
                    ? t('export.failedPartial')
                    : phase.reason === 'empty'
                      ? t('export.failedEmpty')
                      : t('export.failedServer')
            }
          />
        ) : null}
        {/* Obálka publika vylučuje smazané, anonymizované a blokované adresy, takže
            soubor může mít méně řádků než seznam na obrazovce. Říct to dopředu je
            levnější než vysvětlovat rozdíl potom. */}
        {phase?.kind === 'preparing' || phase?.kind === 'ready' ? (
          <p className="text-sm text-text-muted">{t('export.envelopeNote')}</p>
        ) : null}
      </DialogBody>
      <DialogFooter
        retreat={<Button onClick={onClose}>{t('export.close')}</Button>}
        confirm={
          phase?.kind === 'ready' || phase?.kind === 'slow' ? (
            <Button
              variant="primary"
              onClick={() => onDownload(phase.href, state?.fileName ?? 'export')}
            >
              {t('export.download')}
            </Button>
          ) : null
        }
      />
    </Dialog>
  );
}
