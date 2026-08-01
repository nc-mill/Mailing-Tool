'use client';

import { useTranslations } from 'next-intl';
import { descriptorFor } from '../../descriptors/registry';
import type { VisibilityCondition } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { findBlock } from '../../model/tree';
import type { EditorPorts } from '../../ports/types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { PropField } from './prop-field';
import { ThemePanel } from './theme-panel';

export function PropertiesPanel(props: {
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts | null;
}) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  const found = selectedId ? findBlock(document, selectedId) : undefined;

  if (!found) {
    return (
      <aside
        id="editor-properties"
        aria-label={t('a11y.propertiesPanel')}
        className="w-80 shrink-0 overflow-auto border-l border-border p-4"
      >
        <ThemePanel />
      </aside>
    );
  }

  const descriptor = descriptorFor(found.block.type);

  return (
    <aside
      id="editor-properties"
      aria-label={t('a11y.propertiesPanel')}
      className="w-80 shrink-0 space-y-4 overflow-auto border-l border-border p-4"
    >
      <h2 className="text-sm font-semibold">{t(descriptor.label)}</h2>
      {descriptor.groups.length === 0 ? (
        <p className="text-sm">{t('block.lockedHint', { type: found.block.type })}</p>
      ) : null}
      {descriptor.groups.map((group, groupIndex) => (
        // ODCHYLKA OD PLÁNU: skupina nemá `aria-label`, jméno nese `legend`.
        // S obojím by `getByLabelText` našel jak pole, tak celou skupinu, protože
        // se u obou shoduje text (například „Tmavý režim" v panelu motivu).
        <fieldset key={group.label} className="space-y-3">
          <legend className="text-xs uppercase text-text-muted">{t(group.label)}</legend>
          {group.props.map((descriptorProp, propIndex) => (
            <PropField
              key={descriptorProp.key}
              autoFocus={groupIndex === 0 && propIndex === 0}
              descriptor={descriptorProp}
              block={found.block}
              value={
                descriptorProp.kind === 'visibility'
                  ? (found.block.visibleWhen ?? null)
                  : found.block.props[descriptorProp.key]
              }
              canWriteHtml={props.canWriteHtml}
              fieldCatalog={props.fieldCatalog}
              ports={props.ports}
              onChange={(next, extraPatch) => {
                if (descriptorProp.kind === 'visibility') {
                  store.setVisibility(found.block.id, next as VisibilityCondition | null);
                } else {
                  store.patchProps(found.block.id, {
                    [descriptorProp.key]: next,
                    ...extraPatch,
                  });
                }
              }}
            />
          ))}
        </fieldset>
      ))}
    </aside>
  );
}
