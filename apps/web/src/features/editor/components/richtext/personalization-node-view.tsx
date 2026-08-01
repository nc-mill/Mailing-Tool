'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useFieldCatalog, useFieldLabel } from './field-labels';
import { TokenInspector } from './token-inspector';

export function PersonalizationNodeView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations('editor');
  const label = useFieldLabel();
  const catalog = useFieldCatalog();
  const attrs = node.attrs as { expr: string; fallback: string | null; dateFormat: string | null };

  return (
    <NodeViewWrapper as="span">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="token"
            className="rounded bg-surface-muted px-1 text-text"
            aria-label={t('token.tooltip', { label: label(attrs.expr) })}
          >
            {label(attrs.expr)}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <TokenInspector attrs={attrs} fieldCatalog={catalog} onChange={updateAttributes} />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
