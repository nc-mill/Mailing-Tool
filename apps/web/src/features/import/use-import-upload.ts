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
          meta: { filename: file.name, actual: formatBytes(file.size), limit: formatBytes(maxBytes) },
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
          errors?: { code: string; meta?: Record<string, unknown> }[];
        };
        if (xhr.status === 202 && body.id !== undefined) {
          setState({ phase: 'done', importId: body.id });
          return;
        }
        const first = body.errors?.[0];
        setState({
          phase: 'error',
          code: first?.code ?? 'storage_unavailable',
          ...(first?.meta === undefined ? {} : { meta: first.meta }),
        });
      });
      xhr.addEventListener('error', () => setState({ phase: 'error', code: 'storage_unavailable' }));

      const query = opts.force === true ? '?force=true' : '';
      xhr.open('POST', `/api/v1/contacts/imports${query}`);
      xhr.setRequestHeader('Idempotency-Key', crypto.randomUUID());
      xhr.setRequestHeader('X-Workspace-Id', workspaceId);
      xhr.setRequestHeader('X-Filename', file.name);
      xhr.setRequestHeader('Content-Type', file.type || 'text/csv');
      xhr.send(file);
    },
    [accept, maxBytes, workspaceId],
  );

  return { state, upload, cancel, reset };
}
