'use client';

import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { uploadLabels } from './labels';
import { formatBytes, useImportUpload } from './use-import-upload';

export type StepUploadProps = {
  workspaceId: string;
  maxBytes?: number;
  onCreated: (importId: string) => void;
  onGuide?: () => void;
};

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.ms-excel';

/**
 * Krok 1. Nad K4, protože nahrávání s průběhem a zrušením vlastní design systém.
 * Obrazovka dodává jen texty, chybové stavy a dialog nad duplicitou.
 */
export function StepUpload({
  workspaceId,
  maxBytes = 209_715_200,
  onCreated,
  onGuide,
}: StepUploadProps) {
  const t = useTranslations('import');
  const [file, setFile] = useState<File | null>(null);
  const { state, upload, cancel, reset } = useImportUpload({
    workspaceId,
    maxBytes,
    accept: ACCEPT,
  });

  // Ohlášení hotového nahrání patří do efektu, ne do vykreslení. Volání
  // `onCreated` přímo v těle komponenty nastaví stav rodiče PŘI RENDERU,
  // takže se render opakuje a průvodce zapíše krok do historie tolikrát,
  // kolikrát se překreslí.
  const importId = state.phase === 'done' ? state.importId : null;
  useEffect(() => {
    if (importId !== null) onCreated(importId);
  }, [importId, onCreated]);

  const meta = state.phase === 'error' ? ((state.meta ?? {}) as Record<string, string>) : {};

  return (
    <div className="flex flex-col gap-4">
      <FileUpload
        labels={uploadLabels(t)}
        accept={ACCEPT}
        maxBytes={maxBytes}
        formatBytes={formatBytes}
        onFile={(next) => {
          setFile(next);
          upload(next);
        }}
        {...(state.phase === 'uploading' ? { progress: state.percent, onCancel: cancel } : {})}
      />

      <p className="text-sm text-text-muted">{t('upload.limits')}</p>

      <button type="button" className="self-start text-sm underline" onClick={onGuide}>
        {t('upload.guide')}
      </button>

      {state.phase === 'error' && state.code === 'file_too_large' ? (
        <div role="alert" className="flex flex-col gap-1">
          <strong>{t('fileErrors.file_too_large.title')}</strong>
          <p>
            {t('upload.tooLarge', {
              filename: meta['filename'] ?? '',
              actual: meta['actual'] ?? '',
              limit: meta['limit'] ?? formatBytes(maxBytes),
            })}
          </p>
        </div>
      ) : null}

      {state.phase === 'error' && state.code === 'unsupported_format' ? (
        <div role="alert">
          <p>{t('upload.unsupportedFormat', { filename: meta['filename'] ?? '' })}</p>
        </div>
      ) : null}

      {/* Duplicita není chyba, je to otázka. Proto dvě rovnocenná tlačítka
          a ne hláška, ze které uživatel neví, co má dělat dál. */}
      {state.phase === 'error' && state.code === 'import_duplicate' ? (
        <div role="dialog" aria-label={t('duplicateImport.title')} className="flex flex-col gap-2">
          <strong>{t('duplicateImport.title')}</strong>
          <p>{t('duplicateImport.body', { date: String(meta['created_at'] ?? '') })}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onCreated(String(meta['import_id'] ?? ''))}>
              {t('duplicateImport.openOriginal')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (file) upload(file, { force: true });
              }}
            >
              {t('duplicateImport.runAgain')}
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === 'error' &&
      !['file_too_large', 'unsupported_format', 'import_duplicate'].includes(state.code) ? (
        <div role="alert" className="flex flex-col gap-1">
          <strong>{t(`fileErrors.${state.code}.title`)}</strong>
          <p>{t(`fileErrors.${state.code}.nextStep`, meta)}</p>
          <button type="button" onClick={reset}>
            {t('result.uploadAnother')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
