'use client';

// Vzory pod `patterns/` se importují na úroveň **adresáře**: mapa exports zní
// `"./patterns/*": "./src/patterns/*/index.ts"`, takže `patterns/states/alert`
// míří na `src/patterns/states/alert/index.ts`, což není soubor.
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { useAutosave } from '../autosave/use-autosave';
import { useUnloadGuard } from '../autosave/use-unload-guard';
import { MAX_BLOCKS } from '../config';
import type { EditorDocument } from '../model/document-types';
import type { FieldCatalog } from '../model/field-catalog';
import type { EditorPorts } from '../ports/types';
import { createEditorStore } from '../state/editor-store';
import { EditorStoreProvider, useEditorState } from '../state/use-editor';
import { Canvas } from './canvas/canvas';
import { EditorHeader } from './header/editor-header';
import { IssueBar } from './issues/issue-bar';
import { useValidation } from './issues/use-validation';
import { BlockPalette } from './palette/block-palette';
import { PreviewPane } from './preview/preview-pane';
import { PropertiesPanel } from './properties/properties-panel';
import { FieldCatalogProvider } from './richtext/field-labels';
import { TestSendDialog } from './test-send/test-send-dialog';

export type EditorShellProps = {
  templateId: string;
  document: EditorDocument;
  designHash: string;
  canWriteHtml: boolean;
  readOnly: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts;
  /**
   * Panel AI asistenta (P15-R1, výjimka V2 plánu P15). Vykresluje se vedle
   * panelu vlastností, protože uživatel musí vidět, co se v e-mailu mění.
   * Nepovinný: instalace bez AI ho nemá čím naplnit a editor funguje dál.
   */
  assistant?: ReactNode;
};

export function EditorShell(props: EditorShellProps) {
  const t = useTranslations('editor');
  const store = useMemo(
    () => createEditorStore({ document: props.document, designHash: props.designHash }),
    [props.designHash, props.document],
  );
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [testSendOpen, setTestSendOpen] = useState(false);
  const { flush } = useAutosave({ store, ports: props.ports, templateId: props.templateId });
  useUnloadGuard(store);
  useValidation({
    store,
    ports: props.ports,
    templateId: props.templateId,
    fieldCatalog: props.fieldCatalog,
  });

  if (props.document.schemaVersion !== 1) {
    return (
      <Alert data-testid="state-schema-too-new" tone="error" title={t('state.schemaTooNew')} />
    );
  }

  return (
    // ODCHYLKA OD PLÁNU: `LiveRegionProvider`. Oznámení přesunu z úkolu 15 jde
    // přes `useAnnouncer()`, který mimo poskytovatele vyhodí výjimku, takže bez
    // něj se plátno vůbec nevykreslí. Skořápka editoru je jediné rozumné místo:
    // oblasti `aria-live` musí být v DOM dřív, než do nich přijde první text.
    <LiveRegionProvider label={t('a11y.announcements')}>
      <EditorStoreProvider value={store}>
        <FieldCatalogProvider value={props.fieldCatalog}>
          <div className="flex h-dvh flex-col">
            <EditorHeader
              mode={mode}
              onMode={setMode}
              onTestSend={() => setTestSendOpen(true)}
              readOnly={props.readOnly}
            />
            {props.readOnly ? (
              <Alert data-testid="state-read-only" tone="info" title={t('state.readOnly')} />
            ) : null}
            <BlockLimitNotice />
            <IssueBar />
            <div className="flex flex-1 overflow-hidden">
              {mode === 'edit' ? <BlockPalette /> : null}
              <main className="flex-1 overflow-auto">
                {mode === 'edit' ? (
                  <Canvas canWriteHtml={props.canWriteHtml} />
                ) : (
                  <PreviewPane templateId={props.templateId} ports={props.ports} flush={flush} />
                )}
              </main>
              {mode === 'edit' ? (
                <PropertiesPanel
                  canWriteHtml={props.canWriteHtml}
                  fieldCatalog={props.fieldCatalog}
                  ports={props.ports}
                />
              ) : null}
              {mode === 'edit' ? props.assistant : null}
            </div>
            <TestSendDialog
              open={testSendOpen}
              templateId={props.templateId}
              ports={props.ports}
              flush={flush}
              onClose={() => setTestSendOpen(false)}
            />
          </div>
        </FieldCatalogProvider>
      </EditorStoreProvider>
    </LiveRegionProvider>
  );
}

function BlockLimitNotice() {
  const t = useTranslations('editor');
  const count = useEditorState((state) => state.blockCount);
  if (count <= MAX_BLOCKS) return null;
  return (
    <Alert data-testid="state-too-many-blocks" tone="warning" title={t('state.tooManyBlocks')} />
  );
}
