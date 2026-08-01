'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { EDITOR_DND_ENABLED } from '../../config';
import { useCanvasKeyboard } from '../../keyboard/use-canvas-keyboard';
import type { FlatItem } from '../../model/tree';
import { flatten } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { BlockNode } from './block-node';
import { DndCanvas } from './dnd/dnd-canvas';
import { SortableBlock } from './dnd/sortable-block';

export function Canvas({ canWriteHtml }: { canWriteHtml: boolean }) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  const propertiesRef = useRef<HTMLElement | null>(null);
  const onKeyDown = useCanvasKeyboard({
    onFocusProperties: () => {
      propertiesRef.current = window.document.getElementById('editor-properties');
      propertiesRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    },
    onUndoOffer: () => {
      window.dispatchEvent(new CustomEvent('editor:undo-offer'));
    },
  });

  const items = flatten(document);
  const focusId = selectedId ?? items[0]?.block.id ?? null;
  const dndItems = items.map((item) => ({ id: item.block.id, path: item.path }));

  const node = (item: FlatItem, dragHandle: ReactNode) => (
    <BlockNode
      item={item}
      isSelected={item.block.id === selectedId}
      isFocusStop={item.block.id === focusId}
      canWriteHtml={canWriteHtml}
      onSelect={() => store.select(item.block.id)}
      dragHandle={dragHandle}
    />
  );

  const list = EDITOR_DND_ENABLED ? (
    // `SortableContext` a `useSortable` potřebují nadřazený `DndContext`.
    // V degradovaném režimu se proto nevykreslí vůbec a plátno kreslí holé bloky.
    <SortableContext items={dndItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      {items.map((item) => (
        <SortableBlock key={item.block.id} id={item.block.id}>
          {(dragHandle) => node(item, dragHandle)}
        </SortableBlock>
      ))}
    </SortableContext>
  ) : (
    items.map((item) => (
      <div key={item.block.id} role="none">
        {node(item, null)}
      </div>
    ))
  );

  return (
    <DndCanvas items={dndItems} onMove={(id, target) => store.moveBlock(id, target)}>
      <div
        role="tree"
        aria-label={t('a11y.canvas')}
        aria-multiselectable={false}
        className="mx-auto flex w-full max-w-[720px] flex-col gap-1 p-6"
        onKeyDown={onKeyDown}
        data-dnd={EDITOR_DND_ENABLED ? 'on' : 'off'}
      >
        {list}
      </div>
    </DndCanvas>
  );
}
