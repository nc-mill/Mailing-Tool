'use client';

import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_WIDTHS } from '../../config';
import type { EditorPorts, PreviewData } from '../../ports/types';
import { AudiencePicker } from './audience-picker';
import { PreviewToolbar, type PreviewMode } from './preview-toolbar';

export function PreviewPane(props: {
  templateId: string;
  ports: EditorPorts;
  flush: () => Promise<void>;
}) {
  const t = useTranslations('editor');
  const [mode, setMode] = useState<PreviewMode>('desktop');
  const [dark, setDark] = useState(false);
  const [data, setData] = useState<PreviewData>({ type: 'sample', variant: 'default' });
  const [result, setResult] = useState<{ html: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { flush, ports, templateId } = props;

  // Závislosti jsou schválně jen `data`: přepnutí tmavého režimu ani šířky
  // nový náhled nevyžaduje, obojí kreslí komponenta K6 v prohlížeči. Kdyby
  // tu byl `dark`, každé cvaknutí přepínače by znamenalo cestu na server.
  const load = useCallback(async () => {
    setError(null);
    await flush(); // náhled kreslí právě to, co je v editoru
    try {
      setResult(await ports.preview({ templateId, previewData: data }));
    } catch {
      setResult(null);
      setError(t('preview.failed'));
    }
  }, [data, flush, ports, t, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const width = mode === 'mobile' ? PREVIEW_WIDTHS.mobile : PREVIEW_WIDTHS.desktop;

  return (
    <div className="flex flex-1 flex-col">
      <PreviewToolbar mode={mode} onMode={setMode} dark={dark} onDark={setDark} />
      <AudiencePicker ports={props.ports} value={data} onChange={setData} />
      <div className="flex flex-1 justify-center overflow-auto bg-surface-muted p-4">
        {error ? <p role="alert">{error}</p> : null}
        {result && mode === 'text' ? (
          <pre
            data-testid="preview-text"
            className="w-full whitespace-pre-wrap bg-surface p-4 text-sm"
          >
            {result.text}
          </pre>
        ) : null}
        {result && mode === 'source' ? (
          <div className="w-full">
            <p className="mb-1 text-xs text-text-muted">
              {t('preview.sizeKb', { size: Math.round(new Blob([result.html]).size / 1024) })}
            </p>
            <pre className="overflow-x-auto bg-surface p-4 font-mono text-xs">{result.html}</pre>
          </div>
        ) : null}
        {result && (mode === 'desktop' || mode === 'mobile') ? (
          <div data-testid="preview-frame" data-width={width}>
            <EmailPreview
              html={result.html}
              width={width}
              dark={dark}
              title={t('preview.frameTitle')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
