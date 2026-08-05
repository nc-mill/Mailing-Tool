'use client';

import { useCallback, useRef, useState } from 'react';

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  | { phase: 'done'; importId: string }
  | { phase: 'error'; code: string; meta?: Record<string, unknown> };

export type UploadOptions = { workspaceId: string; maxBytes: number; accept: string };

/** Velikost v jednotkách, kterým rozumí člověk. Používá se v obou hláškách o limitu. */
export function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024 * 1024))} GB`;
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} kB`;
  return `${value} B`;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}

/**
 * Název souboru do hlavičky `X-Filename`.
 *
 * HLAVIČKY HTTP UMÍ JEN LATIN-1. „kontakty-červen.csv" tedy do hlavičky
 * v nezměněné podobě nejde: `setRequestHeader` na tom spadne synchronně
 * a nahrávání se zastaví dřív, než cokoli odejde na server. Kódování je
 * procentové nad UTF-8, tedy tvar, ze kterého server dostane jméno zpátky
 * v původní podobě (`decodeFilename` v `imports.routes.ts`).
 *
 * `encodeURIComponent` schválně, ne `escape` ani ruční náhrada háčků:
 * jméno se musí vrátit ZNAK PO ZNAKU, protože se ukazuje uživateli v seznamu
 * importů a v hlášce „Tenhle soubor jste už nahráli".
 */
export function encodeFilename(name: string): string {
  return encodeURIComponent(name);
}

export function acceptsFile(file: File, accept: string): boolean {
  const patterns = accept.split(',').map((item) => item.trim().toLowerCase());
  const extension = extensionOf(file.name);
  const type = file.type.toLowerCase();
  return patterns.some((pattern) =>
    pattern.startsWith('.') ? extension === pattern : type === pattern,
  );
}

/**
 * XMLHttpRequest, ne fetch: fetch v prohlížečích neumí spolehlivě hlásit
 * průběh NAHRÁVÁNÍ (jen stahování), a průběh je u 200 MB souboru podmínka,
 * ne ozdoba. `abort()` pokrývá tvrdý požadavek K4 na zrušení.
 *
 * Tělo je SUROVÝ soubor, ne FormData. Server ho tím může rovnou streamovat
 * na disk (rozhodnutí R4); s multipartem by ho musel nejdřív složit v paměti.
 * Jméno souboru jde v hlavičce `X-Filename`.
 */
export function useImportUpload({ workspaceId, maxBytes, accept }: UploadOptions) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const request = useRef<XMLHttpRequest | null>(null);

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setState({ phase: 'idle' });
  }, []);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  const upload = useCallback(
    (file: File, opts: { force?: boolean } = {}) => {
      // Obě kontroly běží PŘED odesláním. Vyhnat 340 MB na server jen proto,
      // aby přišlo 413, je plýtvání připojením uživatele, ne validace.
      if (!acceptsFile(file, accept)) {
        setState({ phase: 'error', code: 'unsupported_format', meta: { filename: file.name } });
        return;
      }
      if (file.size > maxBytes) {
        setState({
          phase: 'error',
          code: 'file_too_large',
          meta: {
            filename: file.name,
            actual: formatBytes(file.size),
            limit: formatBytes(maxBytes),
          },
        });
        return;
      }

      const xhr = new XMLHttpRequest();
      request.current = xhr;
      setState({ phase: 'uploading', percent: 0 });

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setState({ phase: 'uploading', percent: Math.round((event.loaded / event.total) * 100) });
        }
      });
      xhr.addEventListener('load', () => {
        const body = JSON.parse(xhr.responseText || '{}') as {
          id?: string;
          code?: string;
          params?: Record<string, unknown>;
          errors?: { code: string; meta?: Record<string, unknown> }[];
        };
        if (xhr.status === 202 && body.id !== undefined) {
          setState({ phase: 'done', importId: body.id });
          return;
        }
        /*
         * Doménový kód se čte i z `params`, ne jen z `errors`.
         *
         * Chyby ověření vstupu chodí v poli `errors`, kdežto konflikt přijde
         * jako Problem Details s `code: "conflict"` a doménovým kódem
         * v `params.code`. Čtení jen z `errors` proto na duplicitní soubor
         * dosadilo `storage_unavailable` a obrazovka místo otázky „tenhle
         * soubor už jste nahráli, otevřít původní import?" vypsala „Nepodařilo
         * se uložit soubor. Zkontrolujte místo na disku serveru." Dialog nad
         * duplicitou tím byl nedosažitelný kód. Ověřeno proti dev serveru.
         */
        const first = body.errors?.[0];
        const code = first?.code ?? (body.params?.['code'] as string | undefined) ?? body.code;
        const meta = first?.meta ?? body.params;
        setState({
          phase: 'error',
          code: code ?? 'storage_unavailable',
          ...(meta === undefined ? {} : { meta }),
        });
      });
      xhr.addEventListener('error', () =>
        setState({ phase: 'error', code: 'storage_unavailable' }),
      );

      /*
       * PŘÍPRAVA POŽADAVKU JE V try/catch, a je to oprava vady, která celý
       * import zastavila u prvního kroku.
       *
       * `setRequestHeader` hodí synchronně `TypeError: String contains
       * non ISO-8859-1 code point`, jakmile má hodnota znak mimo Latin-1.
       * Výjimka letěla z obsluhy `onFile`, takže se `xhr.send()` nikdy
       * nespustil, událost `error` nemohla nastat a stav zůstal na
       * „nahrávám". Uživatel vybral soubor a NESTALO SE VŮBEC NIC. Tichá
       * výjimka je horší než chybová hláška, proto tenhle blok: cokoli
       * v přípravě selže, skončí viditelnou hláškou s technickým detailem.
       */
      try {
        const query = opts.force === true ? '?force=true' : '';
        xhr.open('POST', `/api/v1/contacts/imports${query}`);
        xhr.setRequestHeader('Idempotency-Key', crypto.randomUUID());
        xhr.setRequestHeader('X-Workspace-Id', workspaceId);
        xhr.setRequestHeader('X-Filename', encodeFilename(file.name));
        xhr.setRequestHeader('Content-Type', file.type || 'text/csv');
        xhr.send(file);
      } catch (error) {
        console.error(`Soubor ${file.name} se nepodařilo odeslat.`, error);
        request.current = null;
        setState({ phase: 'error', code: 'upload_failed', meta: { detail: String(error) } });
      }
    },
    [accept, maxBytes, workspaceId],
  );

  return { state, upload, cancel, reset };
}
