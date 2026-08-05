'use client';

// Vzory pod `patterns/` se importují na úroveň **adresáře**: mapa exports zní
// `"./patterns/*": "./src/patterns/*/index.ts"`, takže `patterns/states/alert`
// míří na `src/patterns/states/alert/index.ts`, což není soubor.
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { Button } from '@mlain/ui/components/button';
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
import { EditorHandoffProvider } from '../state/use-handoff';
import { EditorStoreProvider, useEditorState, useEditorStore } from '../state/use-editor';
import { Canvas } from './canvas/canvas';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import { EditorDnd } from './canvas/dnd/editor-dnd';
import { EditorHeader } from './header/editor-header';
import type { RenameResult } from './header/template-name';
import { IssueBar } from './issues/issue-bar';
import { useValidation } from './issues/use-validation';
import { BlockPalette } from './palette/block-palette';
import { PreviewPane } from './preview/preview-pane';
import { PropertiesPanel } from './properties/properties-panel';
import { FieldCatalogProvider } from './richtext/field-labels';
import { TestSendDialog } from './test-send/test-send-dialog';
import { AssistantRail } from './assistant/assistant-rail';
import { isReadOnlyMode, useView } from './view/view-state';
import { ViewProvider } from './view/view-state';

export type EditorShellProps = {
  templateId: string;
  /**
   * Profil kontroly dokumentu, odvozený z `templates.kind` funkcí
   * `validationProfileFor` (`@mlain/emails/document/profile`). Skládá ho
   * stránka, editor si ho nevymýšlí.
   *
   * Rozhoduje o tom, jestli je proměnná v odkazu tlačítka chyba (kampaň), nebo
   * normální stav (transakční šablona). Bez něj editor kontroloval transakční
   * šablonu kampaňovými pravidly a uživatel v něm neuložil obsah, který server
   * přijme.
   */
  templateKind: ValidationProfile;
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
  /**
   * Kam se vrátit po uložení, typicky do kampaně, ze které se sem uživatel
   * proklikl. Editor o kampaních nic neví: dostane adresu, popisek tlačítka
   * a případně id kampaně, do které se má obsah po uložení převzít.
   */
  returnTo?: { href: string; label: string; campaignId?: string | undefined } | undefined;
  /**
   * Editor se otevřel nad obsahem JEDNÉ KAMPANĚ, ne nad obecnou šablonou.
   * Mění se tím jen pojmenování v rozhraní, dokument je v obou případech týž.
   */
  contentKind?: 'template' | 'campaign' | undefined;
  /**
   * Název šablony. Když chybí, hlavička pole na název vůbec nenabídne.
   *
   * NENÍ TO OPOMENUTÍ, JE TO ROZHODNUTÍ. Editor se otevírá i nad PRACOVNÍM
   * OBSAHEM KAMPANĚ (`templates.kind = 'system'`), tedy nad řádkem, který si
   * vyrobila aplikace jako plátno pro obsah jedné kampaně. Ten řádek se
   * v knihovně šablon neukazuje a jeho jméno je odvozené od kampaně
   * („Kroky kampane test · <uuid>"). Nabídnout u něj přejmenování by znamenalo
   * dát uživateli pole, jehož výsledek NIKDE NEUVIDÍ: v knihovně ta šablona
   * není a kampaň se jmenuje pořád stejně. Kdo chce přejmenovat kampaň, dělá
   * to v jejím kroku „Předmět a název".
   *
   * Rozhoduje o tom volající podle `kind`, ne editor: editor o kampaních
   * ani o knihovně nic neví a vědět nemá.
   */
  templateName?: string | undefined;
  /**
   * Pruh nad hlavičkou editoru. Sem si kampaň vykreslí svůj pás kroků a ovládání
   * šablon, protože editor JE prvním krokem kampaně, ne odbočkou z něj.
   *
   * Editor o kampaních dál nic neví: dostane hotové uzly a přes `EditorHandoff`
   * jim půjčí uložení a odchod. Kdyby si pruh ukládal sám, vznikla by druhá
   * cesta k zápisu dokumentu.
   */
  chrome?: ReactNode;
};

export function EditorShell(props: EditorShellProps) {
  const t = useTranslations('editor');
  const store = useMemo(
    () => createEditorStore({ document: props.document, designHash: props.designHash }),
    [props.designHash, props.document],
  );
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [testSendOpen, setTestSendOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { flush } = useAutosave({ store, ports: props.ports, templateId: props.templateId });
  useUnloadGuard(store);
  useValidation({
    store,
    ports: props.ports,
    templateId: props.templateId,
    fieldCatalog: props.fieldCatalog,
    templateKind: props.templateKind,
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
          <ViewProvider language={props.document.meta.language}>
            <EditorBody
              {...props}
              mode={mode}
              onMode={setMode}
              flush={flush}
              testSendOpen={testSendOpen}
              onTestSendOpen={setTestSendOpen}
              assistantOpen={assistantOpen}
              onAssistantOpen={setAssistantOpen}
            />
          </ViewProvider>
        </FieldCatalogProvider>
      </EditorStoreProvider>
    </LiveRegionProvider>
  );
}

type BodyProps = EditorShellProps & {
  mode: 'edit' | 'preview';
  onMode: (mode: 'edit' | 'preview') => void;
  flush: () => Promise<void>;
  testSendOpen: boolean;
  onTestSendOpen: (open: boolean) => void;
  assistantOpen: boolean;
  onAssistantOpen: (open: boolean) => void;
};

/**
 * Vnitřek editoru. Je oddělený od `EditorShell` proto, že potřebuje `useView()`,
 * a ten smí volat až potomek `ViewProvider`.
 */
function EditorBody(props: BodyProps) {
  const t = useTranslations('editor');
  const view = useView();
  const { mode, onMode, flush } = props;
  const [returnProblem, setReturnProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  /*
   * TEXTOVÁ VERZE A ZDROJ NEJSOU ÚPRAVY.
   *
   * Obojí umí složit jen server (Liquid, kompilace, prostý text), takže se
   * v nich needituje. Místo plátna se proto kreslí náhled, panely se schovají
   * a nad plochou stojí pruh, který to říká a nabízí jediné kliknutí zpátky.
   * Bez toho by uživatel viděl e-mail, klikal do něj a nic by se nedělo.
   */
  const readOnlyView = isReadOnlyMode(view.mode);
  const editing = mode === 'edit' && !readOnlyView;
  const returnTo = props.returnTo;
  const store = useEditorStore();

  /*
   * PŘEJMENOVÁNÍ: nejdřív dopsat, potom přejmenovat, nakonec převzít výsledek.
   *
   * `flush()` je první schválně. Server přejmenovává NAD SVOU KOPIÍ dokumentu,
   * takže s rozdělanou změnou v editoru by vrátil hash dokumentu, ve kterém ta
   * změna není. Editor si ho převezme a `applyName` navíc prohlásí dokument za
   * uložený, takže by se rozdělaná úprava už nikdy neuložila a po zavření
   * stránky by byla pryč. Se `flush()` napřed jsou obě strany na téže verzi.
   *
   * Chyba se NEVYHAZUJE. Zabrané jméno je odpověď, kterou má rozhraní ukázat
   * u pole, ne pád stromu komponent.
   */
  async function rename(name: string): Promise<RenameResult> {
    await flush();
    const result = await props.ports.rename({ templateId: props.templateId, name });
    if (!result.ok) return result;
    store.applyName(name, result.designHash, Date.now());
    return { ok: true };
  }

  /*
   * Pořadí je závazné: dopsat, převzít, odejít.
   *
   * Nejdřív `flush()`, protože odchod s rozdělanou změnou by do kampaně převzal
   * starší obsah, než jaký má uživatel před očima. Pak převzetí obsahu, protože
   * obsah kampaně je kopie a bez něj by v kampani zůstalo to, co v ní bylo při
   * připojení šablony. Teprve pak odchod.
   *
   * Používá to tlačítko v hlavičce I pás kroků nad ní, proto je to jedna funkce
   * a ne dvě podobné: druhá kopie by se dřív nebo později rozešla v pořadí.
   */
  function leaveTo(href: string): void {
    void (async () => {
      setReturnProblem(null);
      setLeaving(true);
      try {
        await flush();
        if (returnTo?.campaignId) {
          const applied = await props.ports.applyToCampaign({
            campaignId: returnTo.campaignId,
            templateId: props.templateId,
          });
          if (!applied.ok) {
            setReturnProblem(applied.code);
            return;
          }
        }
        window.location.href = href;
      } finally {
        setLeaving(false);
      }
    })();
  }

  return (
    <EditorHandoffProvider value={{ leave: leaveTo, flush, busy: leaving }}>
      <div className="flex h-dvh flex-col">
        {props.chrome}
        <EditorHeader
          mode={mode}
          onMode={onMode}
          onTestSend={() => props.onTestSendOpen(true)}
          onSave={() => {
            void flush();
          }}
          readOnly={props.readOnly}
          ports={props.ports}
          returnTo={returnTo}
          contentKind={props.contentKind}
          templateName={props.templateName}
          onRename={props.templateName === undefined ? undefined : rename}
          onReturn={returnTo ? () => leaveTo(returnTo.href) : undefined}
        />
        {props.readOnly ? (
          <Alert data-testid="state-read-only" tone="info" title={t('state.readOnly')} />
        ) : null}
        {returnProblem ? (
          <Alert
            data-testid="state-return-failed"
            tone="error"
            title={t('state.returnFailed', { code: returnProblem })}
          />
        ) : null}
        {readOnlyView ? (
          <div
            data-testid="view-read-only"
            className="flex items-center justify-between gap-4 border-b border-border bg-surface-muted px-4 py-2"
          >
            <p className="text-sm text-text-muted">
              {t('preview.readOnlyView', { mode: t(`preview.${view.mode}`) })}
            </p>
            <Button variant="secondary" size="sm" onClick={() => view.setMode('desktop')}>
              {t('preview.backToCanvas')}
            </Button>
          </div>
        ) : null}
        <BlockLimitNotice />
        <IssueBar />
        {/*
        Vrstva přetahování obaluje paletu I plátno.
        `@dnd-kit` spojí vlečený prvek s místem upuštění jen uvnitř téhož
        kontextu, takže kdyby seděla jen kolem plátna, nešlo by z palety
        táhnout vůbec nic.
      */}
        <EditorDnd>
          <div className="flex flex-1 overflow-hidden">
            {editing ? <BlockPalette /> : null}
            <main className="flex-1 overflow-auto">
              {editing ? (
                <Canvas
                  canWriteHtml={props.canWriteHtml}
                  fieldCatalog={props.fieldCatalog}
                  ports={props.ports}
                />
              ) : (
                <PreviewPane templateId={props.templateId} ports={props.ports} flush={flush} />
              )}
            </main>
            {editing ? (
              <PropertiesPanel
                canWriteHtml={props.canWriteHtml}
                fieldCatalog={props.fieldCatalog}
                ports={props.ports}
                templateKind={props.templateKind}
              />
            ) : null}
            {editing && props.assistant ? (
              <AssistantRail
                open={props.assistantOpen}
                onOpenChange={props.onAssistantOpen}
                panel={props.assistant}
              />
            ) : null}
          </div>
        </EditorDnd>
        <TestSendDialog
          open={props.testSendOpen}
          templateId={props.templateId}
          ports={props.ports}
          flush={flush}
          onClose={() => props.onTestSendOpen(false)}
          previewData={view.previewData}
        />
      </div>
    </EditorHandoffProvider>
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
