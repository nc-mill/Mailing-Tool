'use client';

import { Wizard } from '@mlain/ui/patterns/wizard';
import { useWizardStep } from '@mlain/ui/patterns/wizard';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { wizardLabels } from './labels';
import { StepFileCheck, type FileCheckPreview } from './step-file-check';
import { StepMapping, type MappingColumn } from './step-mapping';
import { StepOptions, type ListOption } from './step-options';
import { StepPreview, type PreviewRow } from './step-preview';
import { StepProgress } from './step-progress';
import { StepUpload } from './step-upload';

export const STEPS = ['upload', 'fileCheck', 'mapping', 'preview', 'options', 'progress'] as const;
export type Step = (typeof STEPS)[number];

type ApiPreview = {
  encoding: string;
  encoding_source: string;
  delimiter: string;
  has_header: boolean;
  header: string[];
  mapping: Record<string, unknown>;
  rows: {
    row_number: number;
    email: string | null;
    title_prefix: string | null;
    first_name: string | null;
    last_name: string | null;
    gender: string | null;
    greeting: string | null;
    state?: 'ok' | 'error' | 'suppressed' | 'duplicate';
  }[];
  mapping_warnings: string[];
};

export type ImportWizardProps = {
  workspaceId: string;
  workspaceSlug: string;
  locale?: string;
  importId: string | null;
  initialStep?: Step;
  lists?: ListOption[];
  pending?: { filename: string };
};

/**
 * Skořápka průvodce nad K3.
 *
 * Krok je v query (`?step=mapping`), ne v segmentu cesty: předepisuje to
 * 4.3 části 6 a je to jediný tvar, ve kterém jde poslat odkaz na konkrétní
 * krok, aniž by se rozbilo tlačítko zpět v prohlížeči.
 *
 * ŽÁDNÝ `beforeunload` během importu. Úloha běží na serveru a varování
 * „opravdu chcete odejít?" u operace, která na odchodu nezávisí, je lež,
 * která naučí uživatele zavírat všechna varování bez čtení.
 */
export function ImportWizard({
  workspaceId,
  workspaceSlug,
  locale = 'cs',
  importId: initialImportId,
  initialStep = 'upload',
  lists = [],
  pending,
}: ImportWizardProps) {
  const t = useTranslations('import');
  const router = useRouter();
  const { current, goToStep } = useWizardStep({ steps: STEPS.map((id) => ({ id })), defaultStepId: initialStep });
  const step = current as Step;

  const [importId, setImportId] = useState<string | null>(initialImportId);
  const [preview, setPreview] = useState<ApiPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const loadPreview = useCallback(async () => {
    if (importId === null) return;
    const res = await fetch(`/api/v1/contacts/imports/${importId}/preview`, {
      headers: { 'X-Workspace-Id': workspaceId },
    });
    if (!res.ok) return;
    setPreview((await res.json()) as ApiPreview);
  }, [importId, workspaceId]);

  useEffect(() => {
    if (step === 'fileCheck' || step === 'mapping' || step === 'preview') void loadPreview();
  }, [loadPreview, step]);

  const sample: string[][] = preview
    ? [
        preview.header,
        ...preview.rows.slice(0, 2).map((row) => [
          row.email ?? '',
          row.first_name ?? '',
          row.last_name ?? '',
        ]),
      ]
    : [];

  const columns: MappingColumn[] = preview
    ? preview.header.map((name, index) => ({
        name,
        sample: String(Object.values(preview.rows[0] ?? {})[index] ?? ''),
        target: String((preview.mapping as Record<string, string>)[name] ?? 'ignore'),
      }))
    : [];

  const previewRows: PreviewRow[] = (preview?.rows ?? []).map((row) => ({
    rowNumber: row.row_number,
    email: row.email,
    titlePrefix: row.title_prefix,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender,
    greeting: row.greeting,
    state: row.state ?? 'ok',
  }));

  const fileCheck: FileCheckPreview = {
    encoding: preview?.encoding ?? 'utf-8',
    delimiter: preview?.delimiter ?? ';',
    hasHeader: preview?.has_header ?? true,
    totalRows: previewRows.length,
    sample,
  };

  async function patch(body: Record<string, unknown>) {
    if (importId === null) return;
    await fetch(`/api/v1/contacts/imports/${importId}`, {
      method: 'PATCH',
      headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadPreview();
  }

  return (
    <Wizard
      steps={STEPS.map((id) => ({ id, label: t(`wizard.steps.${id}`) }))}
      current={step}
      onNavigate={(next) => goToStep(next)}
      labels={wizardLabels(t)}
      // Návrat z náhledu je destruktivní a musí to říct PŘEDEM: stavový
      // diagram přechod previewing → validating zakazuje, takže se zakládá
      // nový import.
      {...(step === 'preview' ? { destructiveBack: t('wizard.backFromPreview') } : {})}
    >
      {pending ? <p>{t('wizard.resumeBanner', { filename: pending.filename })}</p> : null}
      <p>{t('wizard.resumeExpiry')}</p>

      {step === 'upload' ? (
        <StepUpload
          workspaceId={workspaceId}
          onCreated={(id) => {
            setImportId(id);
            goToStep('fileCheck');
          }}
        />
      ) : null}

      {step === 'fileCheck' ? (
        <StepFileCheck
          preview={fileCheck}
          onConfirm={async (result) => {
            await patch({ encoding: result.encoding, delimiter: result.delimiter });
            goToStep('mapping');
          }}
        />
      ) : null}

      {step === 'mapping' ? (
        <StepMapping
          preview={{ columns }}
          onNext={async (next) => {
            setMapping(next);
            await patch({ mapping: next });
            goToStep('preview');
          }}
        />
      ) : null}

      {step === 'preview' ? (
        <StepPreview
          preview={{ rows: previewRows }}
          estimate={{
            totalRows: previewRows.length,
            shown: previewRows.length,
            reviewRows: previewRows.filter((row) => row.gender === null).length,
            noEmailRows: previewRows.filter((row) => row.email === null || row.email === '').length,
            duplicateRows: previewRows.filter((row) => row.state === 'duplicate').length,
            approximate: false,
          }}
          onNext={() => goToStep('options')}
        />
      ) : null}

      {step === 'options' ? (
        <StepOptions
          estimate={{
            totalRows: previewRows.length,
            errorRows: previewRows.filter((row) => row.state === 'error').length,
            duplicates: previewRows.filter((row) => row.state === 'duplicate').length,
          }}
          lists={lists}
          onSubmit={async (value) => {
            await patch({ options: { on_conflict: value.onConflict, tag: value.tag } });
            if (importId !== null) {
              await fetch(`/api/v1/contacts/imports/${importId}/confirm`, {
                method: 'POST',
                headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
              });
            }
            goToStep('progress');
          }}
        />
      ) : null}

      {step === 'progress' && importId !== null ? (
        <StepProgress
          importId={importId}
          workspaceId={workspaceId}
          locale={locale}
          onDone={() => router.push(`/w/${workspaceSlug}/contacts/import/${importId}`)}
        />
      ) : null}

      {/* Mapování drží skořápka, aby se neztratilo při návratu o krok zpět. */}
      <span hidden data-mapping={JSON.stringify(mapping)} />
    </Wizard>
  );
}
