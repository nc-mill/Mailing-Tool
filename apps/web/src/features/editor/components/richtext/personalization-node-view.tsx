'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useCanvasValues } from '../canvas/render/canvas-context';
import { tokenValue } from '../view/token-value';
import { useFieldCatalog, useFieldLabel } from './field-labels';
import { TokenInspector } from './token-inspector';

export function PersonalizationNodeView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations('editor');
  const label = useFieldLabel();
  const catalog = useFieldCatalog();
  const values = useCanvasValues();
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

  return (
    <NodeViewWrapper as="span">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="token"
            className="rounded-[var(--radius-control)] bg-surface-muted px-1 text-text"
            aria-label={t('token.tooltip', { label: label(attrs.expr) })}
          >
            {substituted ?? label(attrs.expr)}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <TokenInspector attrs={attrs} fieldCatalog={catalog} onChange={updateAttributes} />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
