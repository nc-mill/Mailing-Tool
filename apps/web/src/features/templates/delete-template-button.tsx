'use client';

import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { deleteTemplateAction } from './actions';

export type DeletedTemplate = { id: string; name: string };

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
 */
export function DeleteTemplateButton({
  workspaceId,
  templateId,
  name,
  onDeleted,
  size = 'md',
}: {
  workspaceId: string;
  templateId: string;
  name: string;
  /** Volající rozhodne, co se stane po smazání: nabídka vrácení, nebo odchod z detailu. */
  onDeleted: (template: DeletedTemplate) => void;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('editor');
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
        setFailure(result.code);
        return;
      }
      setOpen(false);
      onDeleted({ id: templateId, name });
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => {
          setFailure(null);
          setOpen(true);
        }}
        data-testid="template-delete"
      >
        {t('list.delete.action')}
      </Button>

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
          className="mt-2"
          data-testid="template-delete-failed"
          title={
            failure === 'template_starter_immutable'
              ? t('list.delete.starterImmutable')
              : // Šablona zapojená do formuláře nebo seznamu. V knihovně se
                // tlačítko u takové ani nenabízí, ale detail šablony o zapojení
                // neví, takže tam se odmítnutí projeví až tady.
                failure === 'template_in_use'
                ? t('list.delete.inUse')
                : t('list.delete.failed', { code: failure })
          }
        />
      ) : null}
    </>
  );
}
