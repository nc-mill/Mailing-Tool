'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
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
      : // Šablona zapojená do formuláře nebo seznamu. V knihovně se položka
        // u takové ani nenabízí, ale detail šablony o zapojení neví, takže
        // tam se odmítnutí projeví až tady.
        code === 'template_in_use'
        ? t('list.delete.inUse')
        : t('list.delete.failed', { code });
}

/**
 * Okno mazání šablony BEZ VLASTNÍHO SPOUŠTĚČE.
 *
 * PROČ SAMOSTATNÝ SOUBOR. Od 6. 8. 2026 se mazání spouští ze tří míst: z pruhu
 * nad editorem šablony, z ikonového tlačítka (obojí přes `DeleteTemplateButton`)
 * a z řádkové nabídky „…" v knihovně. Nabídka spouštěč mít nemůže: položka
 * nabídky je `[role="menuitem"]`, ne tlačítko s oknem uvnitř, a obsah rozbalené
 * nabídky se při volbě odpojí z DOM i s oknem, které by v něm bydlelo. Bez
 * tohohle souboru by v knihovně vznikla DRUHÁ kopie potvrzení, tedy druhý výčet
 * následků, který by se s tímhle časem rozešel.
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
export function TemplateDeleteDialog({
  workspaceId,
  templateId,
  name,
  open,
  onOpenChange,
  onDeleted,
  onFailed,
}: {
  workspaceId: string;
  templateId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Volající rozhodne, co se stane po smazání: nabídka vrácení, nebo odchod z detailu. */
  onDeleted: (template: DeletedTemplate) => void;
  /** Kam patří vysvětlení odmítnutého smazání, viz komentář u `DeleteTemplateButton`. */
  onFailed: (code: string) => void;
}) {
  const t = useTranslations('editor');
  const labels = useConfirmDialogLabels();
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteTemplateAction({ workspaceId, id: templateId });
      if (result.status === 'error') {
        // Okno se ZAVÍRÁ i při chybě, ačkoli by se nabízelo nechat ho otevřené.
        // Dialog je modální se zastíněním, takže hlášku vykreslenou pod tlačítkem
        // by nikdo neviděl, a `ConfirmDialog` místo pro chybu uvnitř nemá.
        // Zavřít a říct důvod na obrazovce je jediná varianta, u které je
        // vysvětlení opravdu vidět.
        onOpenChange(false);
        onFailed(result.code);
        return;
      }
      onOpenChange(false);
      onDeleted({ id: templateId, name });
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
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
  );
}
