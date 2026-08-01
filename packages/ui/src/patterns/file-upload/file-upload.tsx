'use client';

import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Progress } from '../../components/progress';
import { cn } from '../../lib/cn';
import { DEFAULT_CHUNK_SIZE, uploadInChunks } from './chunked-upload';

export type FileUploadLabels = {
  dropzone: string;
  chooseFile: string;
  /** Přístupný název skrytého vstupu. Čtečka ho potřebuje, i když je skrytý. */
  fileInput: string;
  cancel: string;
  progress: (percent: number) => string;
  tooLarge: (limit: string) => string;
  wrongType: string;
  selectedFile: (name: string) => string;
};

/**
 * Rozhodne, jestli soubor projde filtrem `accept`.
 *
 * Kontroluje **příponu i MIME typ**, protože Windows u `.csv` posílá
 * `application/vnd.ms-excel` a někdy prázdný řetězec. Kontrola jen podle
 * MIME typu by odmítla většinu skutečných souborů, se kterými uživatelé
 * k importu přijdou, a to je hlavní scénář celé komponenty.
 */
export function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (patterns.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type !== '' && type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/**
 * Nahrání souboru. Přetažení je **doplněk**, ne jediná cesta:
 * WCAG 2.2 kritérium 2.5.7 žádá, aby všechno, co jde tažením, šlo i bez něj.
 *
 * Klávesovou cestou je **skutečné `<button>`**, ne popisek. Popisek nemá roli
 * tlačítka, čtečka ho neohlásí jako akci a obrys fokusu by se kreslil na něm,
 * zatímco fokus by měl skrytý vstup, který je jeho sourozencem. Vstup je proto
 * mimo pořadí fokusu (`tabIndex={-1}`) a otevírá ho tlačítko.
 *
 * Když volající předá `sendChunk`, komponenta si nahrávání po částech **řídí
 * sama**, včetně průběhu a zrušení. Když ho nepředá, jen ohlásí soubor přes
 * `onFile` a průběh si řídí obrazovka propem `progress`.
 */
export function FileUpload({
  labels,
  accept,
  maxBytes,
  onFile,
  progress,
  onCancel,
  sendChunk,
  chunkSize = DEFAULT_CHUNK_SIZE,
  formatBytes = (value) => `${value} B`,
  className,
}: {
  labels: FileUploadLabels;
  /** Seznam jako u atributu `accept`, například `.csv,.xlsx,text/csv`. */
  accept: string;
  maxBytes: number;
  onFile: (file: File) => void;
  /** Průběh v **procentech**. Řídí ho obrazovka, když si nahrávání dělá sama. */
  progress?: number;
  onCancel?: () => void;
  /** Když je zadaný, komponenta soubor pošle po částech sama. */
  sendChunk?: (input: { index: number; total: number; blob: Blob }) => Promise<void>;
  chunkSize?: number;
  formatBytes?: (bytes: number) => string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ownProgress, setOwnProgress] = useState<number | null>(null);

  // Odpojení komponenty musí rozjeté nahrávání zastavit, jinak by části
  // létaly na server ještě dlouho po odchodu z obrazovky.
  useEffect(() => () => abortRef.current?.abort(), []);

  function reject(message: string) {
    setError(message);
    setSelected(null);
  }

  function handleFile(file: File) {
    if (file.size > maxBytes) {
      reject(labels.tooLarge(formatBytes(maxBytes)));
      return;
    }
    if (!matchesAccept(file, accept)) {
      reject(labels.wrongType);
      return;
    }

    setError(null);
    setSelected(file.name);
    onFile(file);

    if (!sendChunk) return;

    // Nahrávání po částech se skutečně spustí. Bez tohohle volání
    // je funkce `uploadInChunks` mrtvý kód a soubor o 200 MB by se
    // poslal jedním požadavkem.
    const controller = new AbortController();
    abortRef.current = controller;
    setOwnProgress(0);

    void uploadInChunks({
      file,
      chunkSize,
      sendChunk,
      signal: controller.signal,
      onProgress: ({ uploadedBytes, totalBytes }) => {
        setOwnProgress(totalBytes === 0 ? 100 : Math.round((uploadedBytes / totalBytes) * 100));
      },
    })
      .then(() => setOwnProgress(100))
      .catch((cause: unknown) => {
        // Zrušení není chyba, uživatel ho vyvolal sám.
        if (!controller.signal.aborted) reject(String((cause as Error).message));
        setOwnProgress(null);
      })
      .finally(() => {
        abortRef.current = null;
      });
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setOwnProgress(null);
    onCancel?.();
  }

  const shownProgress = progress ?? ownProgress;
  const cancellable = shownProgress !== null && shownProgress !== undefined;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) handleFile(file);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-[var(--radius-surface)] border-2 border-dashed p-8 text-center',
          dragging ? 'border-primary bg-accent-surface' : 'border-border bg-surface',
        )}
      >
        <Upload aria-hidden className="size-6 text-text-muted" />
        <p className="text-sm text-text-muted">{labels.dropzone}</p>

        {/* Povinná klávesová alternativa (WCAG 2.5.7). Skutečné tlačítko:
            má roli, jde na něj tabulátorem a obrys fokusu je na něm. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
        >
          {labels.chooseFile}
        </button>

        <input
          ref={inputRef}
          type="file"
          aria-label={labels.fileInput}
          accept={accept}
          // Mimo pořadí fokusu, aby tabulátor padl na tlačítko, ne sem.
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            // Reset umožní vybrat tentýž soubor znovu po chybě.
            event.target.value = '';
          }}
        />
      </div>

      {selected ? <p className="text-sm text-text">{labels.selectedFile(selected)}</p> : null}

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {cancellable ? (
        <div className="flex flex-col gap-2">
          <Progress
            value={shownProgress}
            max={100}
            label={labels.dropzone}
            valueText={labels.progress(shownProgress as number)}
          />
          <div>
            <Button variant="secondary" onClick={cancel}>
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
