'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { useEditorHandoff } from '@/features/editor/state/use-handoff';
import { saveCampaignContentAsTemplateAction, useLibraryTemplateAction } from './actions';
import { CampaignStepNav } from './campaign-steps';
import { NO_SELECTION } from './no-selection';
import { CAMPAIGN_STEPS, campaignStepHref, type CampaignStep } from './steps';

/**
 * Pruh nad editorem, který z editoru dělá PRVNÍ KROK KAMPANĚ.
 *
 * Dřív byl krok 1 samostatná obrazovka s odkazem „Upravit obsah v editoru".
 * Uživatel tedy musel: otevřít krok 1, kliknout na odkaz, přejít na jinou
 * stránku, napsat e-mail, vrátit se tlačítkem a teprve tam našel cestu na krok 2.
 * Dvě obrazovky navíc kolem jediné věci, kvůli které kampaň vzniká. Editor je
 * proto sám tím krokem a všechno, co k obsahu patří, je tady.
 *
 * Pruh běží UVNITŘ editoru, ne vedle něj: ukládání a odchod si půjčuje přes
 * `useEditorHandoff`, takže obsah kampaně se převezme týmž pořadím kroků, jaké
 * má tlačítko „Pokračovat" v hlavičce. Druhá cesta k zápisu dokumentu nevzniká.
 */
export function CampaignContentChrome({
  workspaceId,
  campaignId,
  campaignName,
  workingCopyId,
  hasDesign,
  templates,
  basePath,
  readOnly,
}: {
  workspaceId: string;
  campaignId: string;
  /** Jméno kampaně z databáze. Předvyplňuje název nové šablony. */
  campaignName: string;
  /** Pracovní kopie obsahu kampaně, tedy dokument otevřený v editoru. */
  workingCopyId: string;
  /** Má kampaň vlastní dokument? Rozhoduje jen o tom, jestli je co přepsat. */
  hasDesign: boolean;
  /** Knihovní šablony, ze kterých jde obsah převzít. */
  templates: ReadonlyArray<{ id: string; name: string }>;
  basePath: string;
  /** Rozjetá kampaň se needituje: zůstává jen pás kroků, akce mizí. */
  readOnly: boolean;
}) {
  const t = useTranslations('campaigns.settings');
  const tContent = useTranslations('campaigns.settings.content');
  const tNew = useTranslations('campaigns.new');
  const labels = useConfirmDialogLabels();
  const handoff = useEditorHandoff();

  const [panel, setPanel] = useState<'none' | 'save' | 'library'>('none');
  const [saveName, setSaveName] = useState(campaignName);
  const [libraryId, setLibraryId] = useState<string>(NO_SELECTION);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  /*
   * Převzetí šablony PŘEPÍŠE dokument, který je zrovna otevřený v editoru.
   *
   * Pořadí je proto závazné: dopsat rozdělané změny, přepsat pracovní kopii
   * a načíst stránku znovu. Bez `flush()` na začátku by automatické ukládání
   * po přepisu odeslalo zpátky ten starý dokument, který má editor ve stavu,
   * a převzatý obsah by zase zmizel. Bez `reload()` na konci by uživatel dál
   * upravoval starý dokument a neviděl, co si právě převzal.
   */
  function useLibrary() {
    if (libraryId === NO_SELECTION) return;
    setConfirming(false);
    setBusy(true);
    void (async () => {
      try {
        await handoff.flush();
        const result = await useLibraryTemplateAction({
          workspaceId,
          campaignId,
          workingCopyId,
          templateId: libraryId,
        });
        if (result.status === 'error') {
          setOutcome({ tone: 'error', text: tContent('loadFailed') });
          return;
        }
        window.location.reload();
      } finally {
        setBusy(false);
      }
    })();
  }

  /** Uložení do knihovny je VÝSLOVNÁ akce, nikdy vedlejší účinek psaní kampaně. */
  function saveAsTemplate() {
    setBusy(true);
    void (async () => {
      try {
        // I tady se nejdřív dopisuje: do knihovny má jít to, co je na obrazovce,
        // ne poslední automaticky uložená verze.
        await handoff.flush();
        const result = await saveCampaignContentAsTemplateAction({
          workspaceId,
          workingCopyId,
          name: saveName,
        });
        if (result.status === 'success') {
          setPanel('none');
          setOutcome({ tone: 'success', text: tContent('savedAsTemplate') });
          return;
        }
        setOutcome({
          tone: 'error',
          text:
            result.code === 'template_name_conflict'
              ? tContent('saveAsTemplateNameTaken')
              : tContent('saveAsTemplateFailed'),
        });
      } finally {
        setBusy(false);
      }
    })();
  }

  function goToStep(step: CampaignStep) {
    handoff.leave(campaignStepHref(basePath, campaignId, step));
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" aria-live="polite" className="text-sm text-text-muted">
            {tNew('stepOf', { current: 1, total: CAMPAIGN_STEPS.length })}
          </span>
          <span className="text-sm font-medium text-text">{campaignName}</span>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="save-as-template"
              onClick={() => {
                setSaveName(campaignName);
                setPanel(panel === 'save' ? 'none' : 'save');
              }}
            >
              {tContent('saveAsTemplate')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="use-library-open"
              onClick={() => setPanel(panel === 'library' ? 'none' : 'library')}
            >
              {tContent('useLibraryTitle')}
            </Button>
          </div>
        )}
      </div>

      {/*
        Pás kroků patří i do editoru, jinak uživatel neví, kde v kampani je,
        a na další krok se dostane jen tlačítkem „Pokračovat" v hlavičce.
        Krok obsahu je tenhle, takže `onSelect` nemá co dělat; ostatní kroky
        jsou jiná adresa a odchází se na ně přes uložení a převzetí obsahu.
      */}
      <CampaignStepNav current="content" onSelect={goToStep} disabled={handoff.busy || busy} />

      <p className="text-sm text-text-muted">{t('steps.contentIntro')}</p>

      {outcome !== null && (
        <Alert tone={outcome.tone} data-testid="content-outcome">
          {outcome.text}
        </Alert>
      )}

      {panel === 'save' && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Label htmlFor="save-as-template-name">{tContent('saveAsTemplateName')}</Label>
          <Input
            id="save-as-template-name"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            maxLength={120}
          />
          <p className="text-sm text-text-muted">{tContent('saveAsTemplateHint')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              data-testid="save-as-template-submit"
              pending={busy}
              pendingLabel={tContent('saving')}
              onClick={saveAsTemplate}
            >
              {tContent('saveAsTemplateSubmit')}
            </Button>
            <Button variant="ghost" onClick={() => setPanel('none')}>
              {tContent('saveAsTemplateCancel')}
            </Button>
          </div>
        </div>
      )}

      {panel === 'library' && (
        <div
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          data-testid="use-library-template"
        >
          {templates.length === 0 ? (
            <p className="text-sm text-text-muted">{tContent('libraryEmpty')}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <SelectField
                name="library_template_id"
                label={tContent('useLibraryTitle')}
                placeholder={tContent('useLibraryPlaceholder')}
                options={templates.map((template) => ({
                  value: template.id,
                  label: template.name,
                }))}
                onSelected={setLibraryId}
              />
              <Button
                variant="secondary"
                data-testid="use-library-submit"
                pending={busy}
                pendingLabel={tContent('loading')}
                onClick={() => {
                  if (libraryId === NO_SELECTION) return;
                  // Ptá se `hasDesign`, ne na to, jestli v dokumentu něco je:
                  // přepisuje se DOKUMENT a přijít se dá i o rozdělanou práci,
                  // ve které zatím nic není.
                  if (hasDesign) setConfirming(true);
                  else useLibrary();
                }}
              >
                {tContent('useLibrarySubmit')}
              </Button>
            </div>
          )}
          <p className="text-sm text-text-muted">{tContent('useLibraryHint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        level="N2"
        irreversible
        title={tContent('confirmTitle')}
        consequences={[tContent('confirmOverwrite'), tContent('confirmTemplateStays')]}
        confirmLabel={tContent('confirmSubmit')}
        cancelLabel={tContent('confirmCancel')}
        onConfirm={useLibrary}
        labels={labels}
      />
    </div>
  );
}
