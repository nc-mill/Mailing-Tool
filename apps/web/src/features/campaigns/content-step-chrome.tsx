'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Copy, Save } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { useEditorHandoff } from '@/features/editor/state/use-handoff';
import { saveCampaignContentAsTemplateAction, useLibraryTemplateAction } from './actions';
import { CampaignBreadcrumbs } from './campaign-breadcrumbs';
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
    <div className="flex flex-col border-b border-border px-[var(--spacing-gutter)] py-[var(--spacing-stack)]">
      {/*
        Hlavička kampaně i v editoru: drobečky zpátky na seznam, číslo kroku
        a jméno kampaně. Bez ní je editor obrazovka bez názvu a uživatel neví,
        kterou kampaň zrovna píše. Spodní mezeru si píše sama, proto obal
        mezeru nemá a zbytek pruhu ji má ve vlastním sloupci.
      */}
      <PageHeader
        title={campaignName}
        eyebrow={
          <span role="status" aria-live="polite">
            {tNew('stepOf', { current: 1, total: CAMPAIGN_STEPS.length })}
          </span>
        }
        breadcrumbs={<CampaignBreadcrumbs basePath={basePath} campaignName={campaignName} />}
        {...(readOnly
          ? {}
          : {
              actions: (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="save-as-template"
                    onClick={() => {
                      setSaveName(campaignName);
                      setPanel(panel === 'save' ? 'none' : 'save');
                    }}
                  >
                    <Save aria-hidden className="icon-sm" />
                    {tContent('saveAsTemplate')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="use-library-open"
                    onClick={() => setPanel(panel === 'library' ? 'none' : 'library')}
                  >
                    <Copy aria-hidden className="icon-sm" />
                    {tContent('useLibraryTitle')}
                  </Button>
                </>
              ),
            })}
      />

      <div className="flex flex-col gap-[var(--spacing-stack)]">
        {/*
        Pás kroků patří i do editoru, jinak uživatel neví, kde v kampani je,
        a na další krok se dostane jen tlačítkem „Pokračovat" v hlavičce.
        Krok obsahu je tenhle, takže `onSelect` nemá co dělat; ostatní kroky
        jsou jiná adresa a odchází se na ně přes uložení a převzetí obsahu.
      */}
        <CampaignStepNav current="content" onSelect={goToStep} disabled={handoff.busy || busy} />

        <p className="max-w-[90ch] text-meta text-text-muted">{t('steps.contentIntro')}</p>

        {outcome !== null && (
          <Alert tone={outcome.tone} data-testid="content-outcome">
            {outcome.text}
          </Alert>
        )}

        {panel === 'save' && (
          <Card tone="muted" padding="sm">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="save-as-template-name">{tContent('saveAsTemplateName')}</Label>
              <Input
                id="save-as-template-name"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                maxLength={120}
              />
              <p className="text-meta text-text-muted">{tContent('saveAsTemplateHint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
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
          </Card>
        )}

        {panel === 'library' && (
          <Card tone="muted" padding="sm" data-testid="use-library-template">
            {templates.length === 0 ? (
              <p className="text-sm text-text-muted">{tContent('libraryEmpty')}</p>
            ) : (
              <div className="flex flex-wrap items-end gap-[var(--spacing-stack)]">
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
            <p className="text-meta text-text-muted">{tContent('useLibraryHint')}</p>
          </Card>
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
    </div>
  );
}
