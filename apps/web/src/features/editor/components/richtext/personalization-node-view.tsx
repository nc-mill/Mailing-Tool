'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useCanvasValues } from '../canvas/render/canvas-context';
import { tokenValue } from '../view/token-value';
import { useView } from '../view/view-state';
import { useFieldCatalog, useFieldLabel } from './field-labels';
import { greetingGuidanceFor } from './greeting-guidance';
import { TokenInspector } from './token-inspector';

export function PersonalizationNodeView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations('editor');
  const label = useFieldLabel();
  const catalog = useFieldCatalog();
  const values = useCanvasValues();
  const { greetingExample } = useView();
  const attrs = node.attrs as { expr: string; fallback: string | null; dateFormat: string | null };
  /*
   * I při psaní platí volba „Zobrazit jako". Kdyby ne, uskočil by text pod
   * kurzorem pokaždé, když uživatel do bloku vstoupí: jinak dlouhý štítek
   * „Oslovení" a jinak dlouhá hodnota „Dobrý den, Jano" lámou řádek jinde.
   * Přístupné jméno zůstává popisek pole, štítek je pořád jeden atomický uzel.
   */
  const substituted = values
    ? tokenValue(values, {
        expr: attrs.expr,
        ...(attrs.fallback ? { fallback: attrs.fallback } : {}),
      })
    : null;

  /*
   * U OSLOVENÍ SE VĚTA ŘEKNE, ŠTÍTEK ZŮSTANE KRÁTKÝ.
   *
   * Nález z provozu: ze štítku „Oslovení" nejde poznat, jestli e-mail začne
   * „Dobrý den, Honzo", nebo „Ahoj Honzo". Vepsat celou větu do štítku nejde:
   * značka je jeden atomický uzel uprostřed odstavce a věta dlouhá jako pět slov
   * by lámala řádek jinde než hotový e-mail, tedy by sazbu spíš rozbila než
   * ukázala. Věta proto jde do bubliny po najetí a do `aria-label`, a celá,
   * i s vysvětlením, je v bublině po kliknutí (`TokenInspector`), která se
   * otevírá i klávesnicí, protože spouštěč je tlačítko.
   *
   * Když se hodnota právě dosazuje („Zobrazit jako"), je věta vidět přímo
   * ve štítku a druhá zmínka v bublině by jen opakovala, co je pod kurzorem.
   */
  const isGreeting = greetingGuidanceFor(attrs.expr) === 'greeting';
  const hint =
    isGreeting && substituted === null && greetingExample !== null
      ? t('token.greetingTooltip', { label: label(attrs.expr), example: greetingExample })
      : t('token.tooltip', { label: label(attrs.expr) });

  return (
    <NodeViewWrapper as="span">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="token"
            className="rounded-[var(--radius-control)] bg-surface-muted px-1 text-text"
            aria-label={hint}
            title={hint}
          >
            {substituted ?? label(attrs.expr)}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <TokenInspector
            attrs={attrs}
            fieldCatalog={catalog}
            onChange={updateAttributes}
            greetingExample={greetingExample}
          />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
