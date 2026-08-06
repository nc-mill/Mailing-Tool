'use client';

import { Button } from '@mlain/ui/components/button';
import { Trash2 } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { deleteTemplateAction } from './actions';

export type DeletedTemplate = { id: string; name: string };

/**
 * Věta k odmítnutému smazání. Je tady, a ne u volajícího, protože překlad kódu
 * na srozumitelný důvod patří k akci, ne k místu, kde se hláška vykreslí.
 */
export function useDeleteFailureText(): (code: string) => string {
  const t = useTranslations('editor');
  return (code) =>
    code === 'template_starter_immutable'
      ? t('list.delete.starterImmutable')
      : // Šablona zapojená do formuláře nebo seznamu. V knihovně se tlačítko
        // u takové ani nenabízí, ale detail šablony o zapojení neví, takže
        // tam se odmítnutí projeví až tady.
        code === 'template_in_use'
        ? t('list.delete.inUse')
        : t('list.delete.failed', { code });
}

/**
 * Smazání šablony jedním tlačítkem a jedním oknem.
 *
 * ÚROVEŇ N2, ne N1 a ne N3 (škála 6.1). Osy: rozsah 0 (jedna položka),
 * obnovitelnost 1 (server maže měkce a hned nabízíme Vrátit zpět, ale po
 * zavření obrazovky už je cesta zpátky jen přes API) a vnější dopad 1
 * (knihovna je společná, šablona zmizí i kolegům). Součet 2 je N2, tedy okno
 * s následky bez zaškrtávátka a bez opisování jména.
 *
 * Okno NEŘÍKÁ, že akce je nevratná, protože nevratná není: `irreversible` je
 * schválně `false` a mezi následky stojí nabídka vrácení zpět. Věta o
 * nenávratnosti u vratné akce je lež, která učí lidi ignorovat i ta okna,
 * kde je pravdivá.
 *
 * DVA VZHLEDY, jedno chování. `appearance="button"` je popsané tlačítko, jak ho
 * potřebuje pruh nad editorem. `appearance="icon"` je ikonové tlačítko v barvě
 * nebezpečí, jak mazání kreslí návrh v řádku výpisu: 34 px, průhledná plocha,
 * rámeček až při najetí. Jméno akce v něm nese `aria-label`, takže odečítač
 * i test slyší totéž slovo jako u popsané varianty.
 */
export function DeleteTemplateButton({
  workspaceId,
  templateId,
  name,
  onDeleted,
  onFailed,
  size = 'md',
  appearance = 'button',
}: {
  workspaceId: string;
  templateId: string;
  name: string;
  /** Volající rozhodne, co se stane po smazání: nabídka vrácení, nebo odchod z detailu. */
  onDeleted: (template: DeletedTemplate) => void;
  /**
   * Kam patří vysvětlení odmítnutého smazání. Bez něj si ho tlačítko vykreslí
   * samo pod sebe. V řádku tabulky to nejde: buňka je široká na ikonu, takže
   * hlášku přebírá výpis a ukáže ji nad seznamem, kde je pro ni místo.
   */
  onFailed?: (message: string) => void;
  size?: 'sm' | 'md';
  appearance?: 'button' | 'icon';
}) {
  const t = useTranslations('editor');
  const failureText = useDeleteFailureText();
  const labels = useConfirmDialogLabels();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setFailure(null);
    startTransition(async () => {
      const result = await deleteTemplateAction({ workspaceId, id: templateId });
      if (result.status === 'error') {
        // Okno se ZAVÍRÁ i při chybě, ačkoli by se nabízelo nechat ho otevřené.
        // Dialog je modální se zastíněním, takže hlášku vykreslenou pod tlačítkem
        // by nikdo neviděl, a `ConfirmDialog` místo pro chybu uvnitř nemá.
        // Zavřít a říct důvod na obrazovce je jediná varianta, u které je
        // vysvětlení opravdu vidět.
        setOpen(false);
        if (onFailed) onFailed(failureText(result.code));
        else setFailure(result.code);
        return;
      }
      setOpen(false);
      onDeleted({ id: templateId, name });
    });
  }

  function start() {
    setFailure(null);
    setOpen(true);
  }

  return (
    <>
      {appearance === 'icon' ? (
        <button
          type="button"
          // Ikona sama význam nenese, proto `aria-hidden` na ní a jméno akce
          // na tlačítku. `title` je jen bublina navíc, ne jediný nositel.
          aria-label={t('list.delete.action')}
          title={t('list.delete.action')}
          data-testid="template-delete"
          onClick={start}
          className={[
            'inline-flex size-[var(--size-control-xs)] items-center justify-center',
            'rounded-[var(--radius-control)] border border-transparent text-danger-text',
            'transition-colors duration-[var(--duration-fast)]',
            'hover:border-danger hover:bg-surface-overlay',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
          ].join(' ')}
        >
          <Trash2 aria-hidden className="icon-sm" />
        </button>
      ) : (
        <Button variant="secondary" size={size} onClick={start} data-testid="template-delete">
          {t('list.delete.action')}
        </Button>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => setOpen(next)}
        level="N2"
        title={t('list.delete.title', { name })}
        consequences={[
          t('list.delete.consequenceLibrary'),
          t('list.delete.consequenceCampaigns'),
          t('list.delete.consequenceVersions'),
          t('list.delete.consequenceUndo'),
        ]}
        irreversible={false}
        confirmLabel={pending ? t('header.saving') : t('list.delete.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirm}
        labels={labels}
      />

      {failure ? (
        <Alert
          tone="error"
          className="mt-[var(--spacing-inline)]"
          data-testid="template-delete-failed"
          title={failureText(failure)}
        />
      ) : null}
    </>
  );
}
