'use client';

import { cn } from '@mlain/ui/lib/cn';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { descriptorFor } from '../../descriptors/registry';
import type { FlatItem } from '../../model/tree';
import { BlockPreview } from './block-preview';
import { BlockToolbar } from './block-toolbar';
import { InsertBetween } from './insert-between';

export function BlockNode(props: {
  item: FlatItem;
  isSelected: boolean;
  isFocusStop: boolean;
  canWriteHtml: boolean;
  onSelect: () => void;
  dragHandle?: React.ReactNode;
}) {
  const { item, isSelected, isFocusStop, canWriteHtml, onSelect } = props;
  const t = useTranslations('editor');
  const descriptor = descriptorFor(item.block.type);
  const locked = descriptor.type === item.block.type && descriptor.groups.length === 0;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected) ref.current?.focus({ preventScroll: false });
  }, [isSelected]);

  return (
    // ODCHYLKA OD PLÁNU: obal má `role="group"`. Bez role by to byl obyčejný div
    // jako přímý potomek `role="tree"`, což axe hlásí jako `aria-required-children`.
    // `group` je povolený potomek stromu a `treeitem` uvnitř něj má povoleného rodiče.
    <div
      role="group"
      className="group relative"
      style={{ marginInlineStart: (item.level - 1) * 12 }}
    >
      <div
        ref={ref}
        role="treeitem"
        data-testid={`block-${item.block.id}`}
        data-locked={locked ? 'true' : undefined}
        aria-level={item.level}
        aria-posinset={item.index + 1}
        aria-setsize={item.siblings}
        aria-selected={isSelected}
        aria-label={`${t(descriptor.label)}`}
        tabIndex={isFocusStop ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onFocus={onSelect}
        className={cn(
          'rounded-md border border-transparent p-2 outline-none',
          isSelected && 'border-primary ring-2 ring-[var(--color-focus-ring)]',
          locked && 'bg-surface-muted text-text-muted',
        )}
      >
        {item.block.visibleWhen ? (
          <p className="mb-1 rounded bg-surface-muted px-2 py-0.5 text-xs">
            {t('visibility.badge', {
              field: item.block.visibleWhen.field,
              op: t(`visibility.op.${item.block.visibleWhen.op}`),
            })}
          </p>
        ) : null}
        {locked ? (
          <p className="text-sm">{t('block.lockedHint', { type: item.block.type })}</p>
        ) : (
          <BlockPreview block={item.block} canWriteHtml={canWriteHtml} />
        )}
      </div>
      {props.dragHandle ?? null}
      {isSelected ? <BlockToolbar blockId={item.block.id} /> : null}
      <InsertBetween item={item} />
    </div>
  );
}
