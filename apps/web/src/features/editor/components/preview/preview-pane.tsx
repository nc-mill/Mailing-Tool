'use client';

import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_WIDTHS } from '../../config';
import type { EditorPorts } from '../../ports/types';
import { useView } from '../view/view-state';

/**
 * Závazný náhled ze serveru.
 *
 * VLASTNÍ OVLADAČE UŽ NEMÁ. Zařízení, tmavý režim i volba „Zobrazit jako" sedí
 * v hlavičce editoru a řídí zároveň plátno, takže tahle komponenta jen kreslí
 * to, co si uživatel navolil. Dvě sady přepínačů by znamenaly dva stavy, které
 * se rozejdou: v hlavičce Mobil, v náhledu Počítač a nikdo neví, co platí.
 */
/**
 * Adresa, kterou vzorová data dosazují za systémové odkazy.
 *
 * `sampleRenderData` v `@mlain/emails` ji vyplňuje SCHVÁLNĚ: odhlašovací odkaz
 * se podepisuje až při odeslání a pro cizí kontakt se kvůli náhledu nepodepisuje.
 * Skutečné adresy staví odesílací vrstva z podepsaného tokenu.
 */
const PREVIEW_LINK_PLACEHOLDER = '#preview-disabled';

/**
 * Vysvětlení místo záhadné značky.
 *
 * V textové verzi náhledu se odkazy vypisují, takže uživatel viděl tři řádky
 * „Odhlásit se z odběru: #preview-disabled" a musel se ptát, co to je. Hodnota
 * je správně, jen mlčí. Nahrazuje se proto až v NÁHLEDU, ne ve vzorových
 * datech: ta patří `@mlain/emails` a jejich podoba je součástí kontraktu.
 *
 * Náhrada nesmí vypadat jako platná adresa, aby si ji nikdo nezkopíroval.
 * V textu je to proto věta v závorce, v HTML kotva bez cíle.
 */
export function explainPreviewLinks(value: string, sentence: string): string {
  return value.split(PREVIEW_LINK_PLACEHOLDER).join(sentence);
}

export function PreviewPane(props: {
  templateId: string;
  ports: EditorPorts;
  flush: () => Promise<void>;
}) {
  const t = useTranslations('editor');
  const view = useView();
  const [result, setResult] = useState<{ html: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { flush, ports, templateId } = props;
  const previewData = view.previewData;

  // Závislosti jsou schválně jen `previewData`: přepnutí tmavého režimu ani
  // šířky nový náhled nevyžaduje, obojí kreslí komponenta K6 v prohlížeči.
  // Kdyby tu byl `dark`, každé cvaknutí přepínače by znamenalo cestu na server.
  const load = useCallback(async () => {
    setError(null);
    await flush(); // náhled kreslí právě to, co je v editoru
    try {
      setResult(await ports.preview({ templateId, previewData }));
    } catch {
      setResult(null);
      setError(t('preview.failed'));
    }
  }, [flush, ports, previewData, t, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const width = view.mode === 'mobile' ? PREVIEW_WIDTHS.mobile : PREVIEW_WIDTHS.desktop;
  // Text vysvětluje větou, HTML kotvou bez cíle: v HTML je adresa v atributu
  // a věta se závorkami by ze zdroje udělala nečitelnou kaši.
  const text = result ? explainPreviewLinks(result.text, t('preview.linkOnSend')) : '';
  const html = result ? explainPreviewLinks(result.html, '#odkaz-vznikne-az-pri-odeslani') : '';

  /*
   * Náhled leží ve stejné kartě jako plátno: tlumená plocha s hairline
   * rámečkem a rádiusem 10 px, uvnitř samotný e-mail na papíru. Bez rámečku
   * to byl pruh přes celou šířku, který se od pozadí stránky nijak nelišil.
   */
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex justify-center rounded-[var(--radius-surface)] border border-border bg-surface-muted p-[var(--spacing-card-tight)]">
        {error ? <p role="alert">{error}</p> : null}
        {result && view.mode === 'text' ? (
          <pre
            data-testid="preview-text"
            className="w-full whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface p-[var(--spacing-gutter)] font-mono text-sm"
          >
            {text}
          </pre>
        ) : null}
        {result && view.mode === 'source' ? (
          <div className="w-full">
            <p className="mb-1 font-mono text-label text-text-muted">
              {t('preview.sizeKb', { size: Math.round(new Blob([html]).size / 1024) })}
            </p>
            <pre
              data-testid="preview-source"
              className="overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface p-[var(--spacing-gutter)] font-mono text-meta"
            >
              {html}
            </pre>
          </div>
        ) : null}
        {result && (view.mode === 'desktop' || view.mode === 'mobile') ? (
          <div data-testid="preview-frame" data-width={width}>
            <EmailPreview
              html={html}
              width={width}
              dark={view.dark}
              title={t('preview.frameTitle')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
