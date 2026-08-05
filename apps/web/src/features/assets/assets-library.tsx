'use client';

import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { AssetDropzone } from './asset-dropzone';
import { DeleteAssetsDialog } from './delete-assets-dialog';
import { deleteMany, type DeleteOutcome } from './delete-assets';
import { formatBytes, toAssetRow, type ApiAssetList, type AssetRow } from './types';
import { uploadMany, type UploadOutcome } from './upload-assets';

/**
 * Knihovna médií projektu.
 *
 * PROČ KLIENTSKÁ KOMPONENTA A NE SERVEROVÉ AKCE. Tahle obrazovka dělá tři věci,
 * které serverová akce neumí: hlásí průběh nahrávání po jednotlivých souborech,
 * hledá při psaní bez překreslení celé stránky a maže dávku s výsledkem po
 * položkách. Server action se vrací až na konci a nemá kanál pro průběh, takže
 * by uživatel u deseti fotek koukal na nehybnou obrazovku. První výpis přesto
 * chodí ze serveru (`initialAssets`), aby obrazovka nezačínala prázdná.
 */

const SEARCH_DEBOUNCE_MS = 250;

export function AssetsLibrary({
  initialAssets,
  workspaceId,
  canWrite,
  loadFailed = false,
  maxUploadBytes,
  locale,
  fetchImpl,
}: {
  initialAssets: AssetRow[];
  workspaceId: string;
  canWrite: boolean;
  loadFailed?: boolean;
  maxUploadBytes: number;
  locale: string;
  /** Vstřikuje se v testech; v prohlížeči se použije `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch;
}) {
  const t = useTranslations('assets');
  const format = useFormatter();

  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null,
  );
  const [uploadResults, setUploadResults] = useState<UploadOutcome[]>([]);
  const [deleteResults, setDeleteResults] = useState<DeleteOutcome[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doFetch = useMemo(
    () => fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    [fetchImpl],
  );

  const reload = useCallback(
    async (search: string) => {
      const url = `/api/v1/assets?limit=200${search === '' ? '' : `&q=${encodeURIComponent(search)}`}`;
      try {
        const response = await doFetch(url, { headers: { 'X-Workspace-Id': workspaceId } });
        if (response.status >= 400) return;
        const body = (await response.json().catch(() => null)) as ApiAssetList | null;
        if (body === null) return;
        setAssets(body.data.map(toAssetRow));
      } catch {
        // Výpadek sítě nesmí knihovnu vyprázdnit: na obrazovce zůstane
        // poslední známý stav, který je pravdivější než prázdná mřížka.
      }
    },
    [doFetch, workspaceId],
  );

  // Hledání se posílá se zpožděním. Bez něj by šel dotaz na server po každém
  // stisku klávesy a odpovědi by se navzájem předbíhaly.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current && query === '') {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setActiveQuery(query);
      void reload(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, reload]);

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selected.has(asset.id)),
    [assets, selected],
  );

  function toggle(id: string, next: boolean) {
    setSelected((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  async function handleFiles(files: File[]) {
    setUploadResults([]);
    setDeleteResults([]);
    setProgress({ done: 0, total: files.length, current: files[0]?.name ?? '' });

    const outcomes = await uploadMany({
      files,
      workspaceId,
      maxBytes: maxUploadBytes,
      onProgress: (done, total, current) => setProgress({ done, total, current }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });

    setProgress(null);
    setUploadResults(outcomes);
    // Znovunačtení, ne skládání seznamu z odpovědí. Nahrání může narazit na
    // deduplikaci a vrátit obrázek, který v mřížce UŽ JE; ruční slučování by
    // ho zdvojilo. Server je jediný, kdo zná pořadí i celkový počet.
    await reload(activeQuery);
  }

  async function handleDelete(deletable: AssetRow[]) {
    setDeleting(true);
    const outcomes = await deleteMany({
      assets: deletable,
      workspaceId,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    setDeleting(false);
    setConfirming(false);
    setDeleteResults(outcomes);
    setSelected(new Set());
    setUploadResults([]);
    await reload(activeQuery);
  }

  const uploaded = uploadResults.filter((result) => result.kind === 'created').length;
  const deleted = deleteResults.filter((result) => result.kind === 'deleted').length;
  const failedDeletes = deleteResults.filter((result) => result.kind !== 'deleted');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('library.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('library.lead')}</p>
        </div>
        <p className="text-sm text-text-muted" data-testid="asset-count">
          {activeQuery === ''
            ? t('library.count', { count: assets.length })
            : t('library.countFiltered', { count: assets.length })}
        </p>
      </header>

      {loadFailed ? (
        <p role="alert" className="text-sm text-danger">
          {t('library.loadFailed')}
        </p>
      ) : null}

      {canWrite ? (
        <AssetDropzone
          onFiles={(files) => void handleFiles(files)}
          disabled={progress !== null}
          maxBytesLabel={formatBytes(maxUploadBytes, locale)}
          progress={progress}
        />
      ) : null}

      {uploadResults.length > 0 ? (
        <section aria-live="polite" data-testid="upload-results" className="text-sm">
          <p className="font-medium text-text">{t('upload.done', { count: uploaded })}</p>
          <ul className="mt-1 space-y-1 text-text-muted">
            {uploadResults
              .filter((result) => result.kind !== 'created')
              .map((result) => (
                <li key={`${result.kind}-${result.file}`}>
                  {result.kind === 'duplicate'
                    ? t('upload.duplicate', { name: result.file })
                    : t('upload.failed', {
                        name: result.file,
                        reason: errorText(t, result.code, formatBytes(maxUploadBytes, locale)),
                      })}
                </li>
              ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setUploadResults([])}>
            {t('upload.dismiss')}
          </Button>
        </section>
      ) : null}

      {deleteResults.length > 0 ? (
        <section aria-live="polite" data-testid="delete-results" className="text-sm">
          <p className="font-medium text-text">{t('delete.resultOk', { count: deleted })}</p>
          <ul className="mt-1 space-y-1 text-text-muted">
            {failedDeletes.map((result) => (
              <li key={result.id}>
                {t('upload.failed', {
                  name: result.name,
                  reason: errorText(t, result.code, formatBytes(maxUploadBytes, locale)),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={query}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        {selected.size > 0 ? (
          <div
            data-testid="selection-bar"
            className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2"
          >
            <span className="text-sm text-text">
              {t('selection.bar', { count: selected.size })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('selection.clear')}
            </Button>
            {canWrite ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
                {t('selection.delete')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {assets.length === 0 ? (
        <EmptyState
          variant={activeQuery === '' ? 'first' : 'filtered'}
          title={activeQuery === '' ? t('empty.title') : t('empty.filteredTitle')}
          explanation={activeQuery === '' ? t('empty.explanation') : t('empty.filteredExplanation')}
          {...(activeQuery === '' ? {} : { filterDescription: t('search.placeholder') })}
          actions={[
            activeQuery === ''
              ? {
                  label: t('empty.action'),
                  onClick: () =>
                    document
                      .querySelector<HTMLButtonElement>('[data-testid=asset-choose-files]')
                      ?.click(),
                }
              : { label: t('empty.filteredAction'), onClick: () => setQuery('') },
          ]}
        />
      ) : (
        <ul
          data-testid="asset-grid"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {assets.map((asset) => (
            <li
              key={asset.id}
              data-testid="asset-tile"
              className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface p-3"
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={selected.has(asset.id)}
                  aria-label={t('tile.select', { name: asset.originalFilename })}
                  onCheckedChange={(next) => toggle(asset.id, next === true)}
                />
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  title={t('tile.open')}
                  className="min-w-0 flex-1"
                >
                  {/* Obyčejný `img`, ne `next/image`: adresa přichází z API za
                      běhu a optimalizátor Nextu by na ni potřeboval statickou
                      konfiguraci domén. Navíc by z obrázku udělal WebP, což je
                      přesně formát, který se do e-mailu nesmí dostat. */}
                  <img
                    src={asset.thumbnailUrl}
                    alt={asset.altText ?? ''}
                    loading="lazy"
                    className="h-28 w-full rounded-[var(--radius-control)] bg-surface-muted object-contain"
                  />
                </a>
              </div>
              <p className="truncate text-sm font-medium text-text" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              <p className="text-xs text-text-muted">
                {asset.width !== null && asset.height !== null
                  ? t('tile.dimensions', { width: asset.width, height: asset.height })
                  : null}
                {' · '}
                {formatBytes(asset.byteSize, locale)}
              </p>
              <p className="text-xs text-text-muted">
                {t('tile.uploaded', {
                  date: format.dateTime(new Date(asset.createdAt), {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                  }),
                })}
              </p>
              <div>
                {asset.referenceCount > 0 ? (
                  <Badge tone="accent" icon={CheckIcon}>
                    {t('usage.used', { count: asset.referenceCount })}
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon={SlashIcon}>
                    {t('usage.unused')}
                  </Badge>
                )}
                {asset.altText === null || asset.altText === '' ? (
                  <span className="ml-2 inline-block align-middle">
                    <Badge tone="warning" icon={WarningIcon}>
                      {t('tile.noAlt')}
                    </Badge>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <DeleteAssetsDialog
        open={confirming}
        assets={selectedAssets}
        workspaceId={workspaceId}
        pending={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={(deletable) => void handleDelete(deletable)}
        {...(fetchImpl === undefined ? {} : { fetchImpl })}
      />
    </section>
  );
}

/**
 * Kód chyby na větu.
 *
 * Klíč se skládá jako `errors.<kód>` a je to jediné místo, kde se klíč katalogu
 * skládá za běhu. Alternativa (mapa kód → klíč) by musela mít stejně jednu
 * položku na kód, jenže by navíc mlčky spadla na prázdný řetězec, kdyby doména
 * přidala kód, který zatím nezná. Takhle se sáhne po `errors.unknown`,
 * což je věta, kterou uživatel přečte.
 */
function errorText(
  t: ReturnType<typeof useTranslations<'assets'>>,
  code: string,
  limit: string,
): string {
  const known = [
    'asset_unsupported_format',
    'asset_corrupt',
    'asset_too_many_pixels',
    'payload_too_large',
    'asset_quota_exceeded',
    'asset_referenced_by_sent_campaign',
    'forbidden',
    'tooLargeLocal',
    'wrongTypeLocal',
  ];
  if (!known.includes(code)) return t('errors.unknown');
  return t(`errors.${code}` as 'errors.unknown', { limit });
}
