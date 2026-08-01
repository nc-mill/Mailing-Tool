'use client';

import { useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { Workspace } from '@/lib/identity/workspace-access';
import { deleteWorkspaceFormAction } from './actions-forms';

export type DangerZoneViewProps = {
  workspace: Workspace;
  action: (formData: FormData) => void;
};

/**
 * ODCHYLKA OD PLÁNU, vynucená rozhraním P05: plán řídil opisované pole zvenčí
 * (`confirmPhrase={workspace.name}` plus `onConfirmPhraseChange`). `ConfirmDialog`
 * ale jedním propem `confirmPhrase` popisuje **očekávaný** text i **aktuální**
 * hodnotu, takže v řízeném režimu předvyplní pole názvem projektu a shodu
 * vyhodnotí vždycky kladně. Opisování by tím přestalo cokoli chránit.
 *
 * Dialog proto zůstává neřízený: drží si napsaný text sám a `onConfirm` zavolá
 * jedině při přesné shodě. Skryté pole `confirm_name` nese název projektu,
 * protože v okamžiku odeslání je to přesně to, co uživatel opsal, a server
 * si shodu ověřuje znovu. Je to zároveň požadavek na P05: rozdělit očekávanou
 * frázi a napsanou hodnotu do dvou propů.
 */
export function DangerZoneView({ workspace, action }: DangerZoneViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="general-danger" className="rounded-lg border border-danger p-6">
      <h2 id="general-danger" className="text-xl font-semibold">
        {t('general.danger.title')}
      </h2>
      <p className="mt-2 text-text-muted">{t('general.danger.body')}</p>

      <form ref={formRef} action={action} className="mt-4">
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="confirm_name" value={workspace.name} readOnly />

        {/* ODCHYLKA OD PLÁNU: destruktivní varianta `Button` z P05 se jmenuje
            `destructive`, ne `danger`. Atribut `data-variant` zůstává, protože
            se na něj dívá test a je to zároveň úchyt pro průchody v prohlížeči. */}
        <Button
          type="button"
          variant="destructive"
          data-variant="danger"
          onClick={() => setOpen(true)}
        >
          {t('general.danger.button')}
        </Button>

        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          level="N4"
          title={t('general.danger.dialogTitle', { name: workspace.name })}
          consequences={[
            t('general.danger.consequence1'),
            t('general.danger.consequence2'),
            t('general.danger.consequence3'),
            t('general.danger.consequence4'),
            // Dřív to byl prop `irreversibleNote`, který `ConfirmDialog` nemá.
            // Je to následek jako každý jiný, takže patří do seznamu následků;
            // nevratnost samotnou hlásí komponenta z `labels.irreversible`.
            t('general.danger.restoreNote'),
          ]}
          confirmPhrase={workspace.name}
          confirmPhraseLabel={t('general.danger.confirmLabel')}
          confirmLabel={t('general.danger.confirm', { name: workspace.name })}
          cancelLabel={t('general.danger.cancel')}
          onConfirm={() => formRef.current?.requestSubmit()}
          labels={confirmLabels}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function DangerZone({ workspace }: { workspace: Workspace }) {
  return <DangerZoneView workspace={workspace} action={deleteWorkspaceFormAction} />;
}
