'use client';

import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Search, Upload } from '@mlain/ui/icons';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
 *
 * VZHLED. Návrh tuhle obrazovku nemá, takže drží rytmus navržených: hlavička,
 * filtr, obsah. Mřížka náhledů je obdoba mřížky dlaždic z Přehledu, jen s tím
 * rozdílem, že se dlaždice dosypávají (`auto-fill`), aby jediný obrázek nebyl
 * roztažený přes celou šířku.
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

  /** Otevře systémový výběr souborů. Tlačítko v hlavičce i prázdný stav míří sem. */
  function chooseFiles() {
    document.querySelector<HTMLButtonElement>('[data-testid=asset-choose-files]')?.click();
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
  const failedUploads = uploadResults.filter((result) => result.kind !== 'created');
  const failedDeletes = deleteResults.filter((result) => result.kind !== 'deleted');
  const unused = assets.filter((asset) => asset.referenceCount === 0).length;

  /**
   * Řádek pod názvem obrazovky. Dvě samostatná tvrzení oddělená středovou
   * tečkou: kolik obrázků je vidět a kolik z nich nikde není. Nepoužitý obrázek
   * je jediný, který jde smazat bez následků, takže je to údaj k rozhodnutí,
   * ne ozdoba. Při hledání se nepoužité nepočítají, protože by se ten počet
   * vztahoval k výsledku hledání a četl by se jako celková knihovna.
   */
  const meta = (
    <span data-testid="asset-count">
      {activeQuery === ''
        ? t('library.count', { count: assets.length })
        : t('library.countFiltered', { count: assets.length })}
      {activeQuery === '' && assets.length > 0
        ? ` · ${t('library.countUnused', { count: unused })}`
        : ''}
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('library.title')}
        meta={meta}
        actions={
          canWrite ? (
            <Button variant="primary" onClick={chooseFiles}>
              <Upload aria-hidden className="icon-md" />
              {t('library.upload')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {/* Věta stojí NAD plochou pro nahrání, ne v hlavičce: vysvětluje převod
            formátů, tedy jediné překvapení téhle obrazovky (nahraju WebP, v knihovně
            mám PNG), a to se týká právě toho, co je pod ní. V hlavičce je místo ní
            mono meta řádek s počty, protože knihovna je výpis. */}
        <p className="max-w-[var(--size-text-column)] text-body text-text-muted">
          {t('library.lead')}
        </p>

        {loadFailed ? <Alert tone="error">{t('library.loadFailed')}</Alert> : null}

        {canWrite ? (
          <AssetDropzone
            onFiles={(files) => void handleFiles(files)}
            disabled={progress !== null}
            maxBytesLabel={formatBytes(maxUploadBytes, locale)}
            progress={progress}
          />
        ) : null}

        {uploadResults.length > 0 ? (
          <Alert
            tone={failedUploads.length > 0 ? 'warning' : 'success'}
            title={t('upload.done', { count: uploaded })}
            data-testid="upload-results"
            aria-live="polite"
            action={
              <Button variant="ghost" size="sm" onClick={() => setUploadResults([])}>
                {t('upload.dismiss')}
              </Button>
            }
          >
            {failedUploads.length === 0 ? null : (
              <ul className="flex flex-col gap-[var(--spacing-hairline)]">
                {failedUploads.map((result) => (
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
            )}
          </Alert>
        ) : null}

        {deleteResults.length > 0 ? (
          <Alert
            tone={failedDeletes.length > 0 ? 'warning' : 'success'}
            title={t('delete.resultOk', { count: deleted })}
            data-testid="delete-results"
            aria-live="polite"
          >
            {failedDeletes.length === 0 ? null : (
              <ul className="flex flex-col gap-[var(--spacing-hairline)]">
                {failedDeletes.map((result) => (
                  <li key={result.id}>
                    {t('upload.failed', {
                      name: result.name,
                      reason: errorText(t, result.code, formatBytes(maxUploadBytes, locale)),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        ) : null}

        {/* Hledání. Stejný tvar jako na Kontaktech: rámeček pole, ikona vlevo,
            vlastní `input` bez rámečku uvnitř, aby lupa a text seděly v jednom
            poli a ne vedle sebe. */}
        <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
          {/* MINIMÁLNÍ ŠÍŘKA PLATÍ AŽ OD 640 px. Pevných 280 px je na displeji
              375 px víc, než kolik hlavnímu sloupci vedle bočního menu vůbec
              zbude, takže pole začínalo za pravým okrajem a stránka přetékala
              vodorovně. Pod tou hranicí se pole roztáhne na to, co je k mání. */}
          <div className="flex h-[var(--size-control)] w-full items-center gap-[var(--spacing-inline)] rounded-[var(--radius-control)] border border-border-strong bg-field px-3.5 sm:w-auto sm:min-w-[280px]">
            <Search aria-hidden className="icon-sm text-text-muted" />
            <input
              type="search"
              // Do hledání nepatří uložené heslo. Bez těchhle značek nad pole
              // vyskočí nabídka správce hesel a zakryje mřížku náhledů.
              // Proč jich je šest, vysvětluje `@mlain/ui/lib/password-manager`.
              {...passwordManagerOptOut}
              value={query}
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
              className="h-full w-full min-w-0 border-0 bg-transparent text-ui text-text outline-none placeholder:text-text-muted"
            />
          </div>
        </div>

        {/* Pruh hromadného výběru je TMAVÝ PANEL, stejně jako u tabulek. Výběr je
            na papíru cizí těleso, dokud ho uživatel nezruší. */}
        {selected.size > 0 ? (
          <div
            data-testid="selection-bar"
            className="flex flex-wrap items-center gap-[var(--spacing-inline)] rounded-[var(--radius-surface)] bg-panel px-[var(--spacing-row-x)] py-3 font-mono text-meta text-panel-foreground"
          >
            <span>{t('selection.bar', { count: selected.size })}</span>
            <Button
              variant="link"
              className="text-panel-soft hover:text-panel-foreground"
              onClick={() => setSelected(new Set())}
            >
              {t('selection.clear')}
            </Button>
            {canWrite ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
                {t('selection.delete')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {assets.length === 0 ? (
          <EmptyState
            variant={activeQuery === '' ? 'first' : 'filtered'}
            title={activeQuery === '' ? t('empty.title') : t('empty.filteredTitle')}
            explanation={
              activeQuery === '' ? t('empty.explanation') : t('empty.filteredExplanation')
            }
            {...(activeQuery === '' ? {} : { filterDescription: t('search.placeholder') })}
            actions={[
              activeQuery === ''
                ? { label: t('empty.action'), onClick: chooseFiles }
                : { label: t('empty.filteredAction'), onClick: () => setQuery('') },
            ]}
          />
        ) : (
          <ul
            data-testid="asset-grid"
            // Dlaždice jsou širší než dlaždice s číslem na Přehledu (230 px):
            // pod náhledem stojí dva odznaky vedle sebe a v užší dlaždici by se
            // lámaly pod sebe na každé z nich.
            // Minimum sloupce je `min(260px, 100%)`: holých 260 px je TVRDÉ
            // minimum a na užším sloupci mřížka přeteče ven ze stránky místo
            // toho, aby se zúžila.
            className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-[var(--spacing-gutter)]"
          >
            {assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                locale={locale}
                selected={selected.has(asset.id)}
                onToggle={(next) => toggle(asset.id, next)}
                dateLabel={t('tile.uploaded', {
                  date: format.dateTime(new Date(asset.createdAt), {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                  }),
                })}
              />
            ))}
          </ul>
        )}
      </div>

      <DeleteAssetsDialog
        open={confirming}
        assets={selectedAssets}
        workspaceId={workspaceId}
        pending={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={(deletable) => void handleDelete(deletable)}
        {...(fetchImpl === undefined ? {} : { fetchImpl })}
      />
    </>
  );
}

/**
 * Jedna dlaždice knihovny.
 *
 * ZAŠKRTNUTÍ LEŽÍ NA NÁHLEDU, ne vedle něj: v mřížce je náhled to jediné, co
 * uživatel hledá očima, a sloupeček se zaškrtnutím vlevo by ho zúžil. Plocha
 * pod ním má proto plných 44 px a je to `<label>`, takže se kliká celá, ne jen
 * šestnáctibodový čtvereček uvnitř.
 */
function AssetTile({
  asset,
  locale,
  selected,
  onToggle,
  dateLabel,
}: {
  asset: AssetRow;
  locale: string;
  selected: boolean;
  onToggle: (next: boolean) => void;
  dateLabel: string;
}) {
  const t = useTranslations('assets');
  const checkboxId = useId();

  return (
    // `Card` je `section` nebo `div`, ne `li`, takže položku mřížky drží `li`
    // a karta je uvnitř. Roztažení na plnou výšku dělá `flex` na `li`: odznaky
    // dole pak stojí na jedné lince napříč řadou.
    <li className="flex min-w-0" data-testid="asset-tile">
      <Card as="div" padding="sm" gap="none" className="w-full gap-[var(--spacing-inline)]">
        <div className="relative">
          <a
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            title={t('tile.open')}
            className="block"
          >
            {/* Obyčejný `img`, ne `next/image`: adresa přichází z API za běhu
                a optimalizátor Nextu by na ni potřeboval statickou konfiguraci
                domén. Navíc by z obrázku udělal WebP, což je přesně formát, který
                se do e-mailu nesmí dostat. */}
            <img
              src={asset.thumbnailUrl}
              alt={asset.altText ?? ''}
              loading="lazy"
              // Poměr stran, ne pevná výška v bodech: dlaždice se v mřížce roztahují
              // podle šířky okna, takže pevná výška by u širokého okna nechala kolem
              // náhledu pruhy plochy. `object-contain` drží celý obrázek uvnitř,
              // protože v knihovně se vybírá podle toho, co na obrázku je.
              className="aspect-[4/3] w-full rounded-[var(--radius-control)] bg-surface-muted object-contain"
            />
          </a>
          <label
            htmlFor={checkboxId}
            className="absolute top-0 left-0 grid size-[var(--size-target-min)] cursor-pointer place-items-center"
          >
            <Checkbox
              id={checkboxId}
              checked={selected}
              aria-label={t('tile.select', { name: asset.originalFilename })}
              onCheckedChange={(next) => onToggle(next === true)}
            />
          </label>
        </div>

        <p className="truncate text-ui font-semibold text-text" title={asset.originalFilename}>
          {asset.originalFilename}
        </p>

        {/* Rozměry, velikost a datum se čtou po znacích, takže mono. */}
        <p className="font-mono text-label text-text-muted">
          {asset.width !== null && asset.height !== null
            ? t('tile.dimensions', { width: asset.width, height: asset.height })
            : null}
          {' · '}
          {formatBytes(asset.byteSize, locale)}
        </p>
        <p className="font-mono text-label text-text-muted">{dateLabel}</p>

        {/* Odznaky ke dnu, aby v mřížce stály na jedné lince i u dlaždic s různě
            dlouhým názvem souboru. */}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-[var(--spacing-hairline)]">
          {asset.referenceCount > 0 ? (
            <Badge tone="accent">{t('usage.used', { count: asset.referenceCount })}</Badge>
          ) : (
            <Badge tone="neutral">{t('usage.unused')}</Badge>
          )}
          {asset.altText === null || asset.altText === '' ? (
            <Badge tone="warning">{t('tile.noAlt')}</Badge>
          ) : null}
        </div>
      </Card>
    </li>
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
