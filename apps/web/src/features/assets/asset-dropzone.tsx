'use client';

import { Button } from '@mlain/ui/components/button';
import { Progress } from '@mlain/ui/components/progress';
import { useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent } from 'react';
import { ACCEPT_ATTRIBUTE } from './upload-assets';

/**
 * Plocha pro nahrání obrázků přetažením.
 *
 * PŘETAŽENÍ JE DOPLNĚK, NE JEDINÁ CESTA. WCAG 2.2, kritérium 2.5.7 („Dragging
 * Movements") žádá, aby všechno, co jde tažením, šlo i bez něj, a tažení se
 * navíc nedá ovládat z klávesnice ani z hlasového ovládání. Klávesovou cestou
 * je proto SKUTEČNÉ `<button>`, ne popisek nad skrytým vstupem: popisek nemá
 * roli tlačítka, čtečka ho neohlásí jako akci a obrys fokusu by se kreslil na
 * něm, zatímco fokus by měl skrytý vstup vedle. Vstup je tedy mimo pořadí
 * fokusu (`tabIndex={-1}`) a otevírá ho tlačítko.
 *
 * PROČ NE `FileUpload` Z `@mlain/ui/patterns/file-upload`. Ten bere JEDEN
 * soubor (`onFile: (file: File) => void`, vstup bez `multiple`) a je stavěný
 * na import CSV po částech. Knihovna médií potřebuje víc souborů naráz
 * a výsledek po jednotlivých souborech, což je jiný tvar rozhraní, ne jiné
 * nastavení téhož.
 *
 * `dragCounter` místo prostého `boolean`: `dragleave` se pálí i při přejezdu
 * mezi POTOMKY plochy, takže by rámeček při tažení nad textem uvnitř blikal.
 * Počítadlo párů enter/leave to řeší tím, že se dívá na vnořování.
 */
export function AssetDropzone({
  onFiles,
  disabled = false,
  maxBytesLabel,
  progress,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Limit velikosti slovy, například „10 MB“. Jde do nápovědy pod plochou. */
  maxBytesLabel: string;
  /** Průběh dávky, nebo `null`, když se nic nenahrává. */
  progress: { done: number; total: number; current: string } | null;
}) {
  const t = useTranslations('assets');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragCounter, setDragCounter] = useState(0);
  const dragging = dragCounter > 0;

  function accept(list: FileList | null) {
    if (disabled || list === null || list.length === 0) return;
    onFiles([...list]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragCounter(0);
    accept(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-stack)]">
      <div
        data-testid="asset-dropzone"
        data-dragging={dragging ? '' : undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragCounter((value) => value + 1);
        }}
        onDragLeave={() => setDragCounter((value) => Math.max(0, value - 1))}
        onDragOver={(event) => {
          // Bez `preventDefault` u `dragover` prohlížeč soubor OTEVŘE místo
          // toho, aby ho pustil do stránky, a uživatel přijde o rozdělanou práci.
          event.preventDefault();
        }}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center gap-[var(--spacing-stack)] text-center',
          // Přerušovaný rámeček je jediné místo v systému, kde rámeček není
          // hairline: plocha se nemá číst jako karta, ale jako místo, kam se
          // něco pustí. Při tažení se přebarví do identitní žluté.
          'rounded-[var(--radius-surface)] border-2 border-dashed p-[var(--spacing-card)]',
          dragging ? 'border-primary bg-surface-muted' : 'border-border bg-surface',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        <p className="text-body font-semibold text-text">{t('upload.dropzone')}</p>
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          data-testid="asset-choose-files"
        >
          {t('upload.chooseFiles')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label={t('upload.fileInput')}
          // Mimo pořadí fokusu: cestu z klávesnice drží tlačítko výš. Se vstupem
          // v pořadí by uživatel klávesnicí procházel dva prvky pro jednu akci.
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            // Vynulování hodnoty: bez něj by druhý výběr TÉHOŽ souboru
            // nevyvolal `change` a nahrání by se tiše nestalo.
            event.target.value = '';
          }}
        />
        <p className="text-meta text-text-muted">{t('upload.hint', { limit: maxBytesLabel })}</p>
      </div>

      {progress === null ? null : (
        <div className="flex flex-col gap-[var(--spacing-hairline)]" aria-live="polite">
          <p className="font-mono text-meta text-text-muted">
            {t('upload.progress', { done: progress.done, total: progress.total })}
            {progress.current === '' ? '' : ` · ${progress.current}`}
          </p>
          <Progress
            value={progress.done}
            max={progress.total}
            label={t('upload.progressLabel')}
            valueText={t('upload.progress', { done: progress.done, total: progress.total })}
          />
        </div>
      )}
    </div>
  );
}
