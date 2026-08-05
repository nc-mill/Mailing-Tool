'use client';

import { Link } from '@mlain/i18n/navigation';
import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FormatGuide } from './format-guide';
import { uploadLabels } from './labels';
import { formatBytes, useImportUpload } from './use-import-upload';

export type StepUploadProps = {
  workspaceId: string;
  workspaceSlug: string;
  maxBytes?: number;
  onCreated: (importId: string) => void;
};

/** Stavy, ve kterých se dá v rozdělaném importu pokračovat průvodcem. */
const UNFINISHED = ['pending', 'validating', 'previewing'];

/** Datum nahrání ze serveru je ISO řetězec; člověk chce datum a čas ve svém jazyce. */
function formatUploadedAt(value: unknown, locale: string): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

/**
 * ŽÁDNÉ `.xlsx`. Sešit z Excelu tady dřív stál, jenže přečíst ho neumíme:
 * čtečka souboru je `csv-parse` a detekce kódování nad zipem skončí hláškou
 * „Kódování souboru neumíme přečíst". Ověřeno v prohlížeči 2026-08-05 nahráním
 * sešitu. Slíbit formát, který skončí chybou až po nahrání, je horší než ho
 * nenabídnout: uživatel z hlášky usoudí, že má rozbitý soubor.
 */
const ACCEPT = '.csv,text/csv';

/**
 * Krok 1. Nad K4, protože nahrávání s průběhem a zrušením vlastní design systém.
 * Obrazovka dodává jen texty, chybové stavy a dialog nad duplicitou.
 */
export function StepUpload({
  workspaceId,
  workspaceSlug,
  maxBytes = 209_715_200,
  onCreated,
}: StepUploadProps) {
  const t = useTranslations('import');
  const locale = useLocale();
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

      {/* Nápověda k formátu. Tlačítko tu bylo od začátku, ale volalo nepovinnou
          propu `onGuide`, kterou mu průvodce nikdy nepředal, takže kliknutí
          nedělalo nic a o podobě souboru se uživatel nikde nedozvěděl vůbec nic.
          Panel je součástí kroku, tím žádná propa chybět nemůže. */}
      <FormatGuide />

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
          a ne hláška, ze které uživatel neví, co má dělat dál.

          Klíče v `meta` jsou ty, které SKUTEČNĚ chodí ze serveru, tedy
          `importId`, `status` a `createdAt` z `params` konfliktní odpovědi.
          Dřív se tu četlo `import_id` a `created_at`, které server nikdy
          neposlal, takže tlačítko „Otevřít původní import" otevíralo prázdné
          id a věta o duplicitě neměla datum. */}
      {state.phase === 'error' && state.code === 'import_duplicate' ? (
        <div role="dialog" aria-label={t('duplicateImport.title')} className="flex flex-col gap-2">
          <strong>{t('duplicateImport.title')}</strong>
          <p>{t('duplicateImport.body', { date: formatUploadedAt(meta['createdAt'], locale) })}</p>
          <div className="flex gap-2">
            {/* Rozdělaný import se otevře v průvodci, dokončený na jeho
                výsledku: krok Kontrola souboru u dokončeného importu skončí
                na 409, protože ze stavu `completed` se nikam přejít nedá. */}
            {UNFINISHED.includes(String(meta['status'] ?? '')) ? (
              <button type="button" onClick={() => onCreated(String(meta['importId'] ?? ''))}>
                {t('duplicateImport.openOriginal')}
              </button>
            ) : (
              <Link href={`/w/${workspaceSlug}/contacts/import/${String(meta['importId'] ?? '')}`}>
                {t('duplicateImport.openOriginal')}
              </Link>
            )}
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
