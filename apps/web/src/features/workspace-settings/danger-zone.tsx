'use client';

import { useActionState, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Workspace } from '@/lib/identity/workspace-access';
import { deleteWorkspaceAction } from './actions';

export type DangerZoneViewProps = {
  workspace: Workspace;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
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
 *
 * OPRAVA VADY ze stejného rodu jako u přepínání oslovení: obálka
 * `deleteWorkspaceFormAction` výsledek akce zahazovala, takže odmítnuté
 * smazání (nedostatečné oprávnění, neshoda názvu na serveru) skončilo bez
 * jediného slova a tlačítko vypadalo mrtvě. Akce proto běží přes
 * `useActionState` a chyba se vykreslí. Úspěch se nevykresluje: akce
 * přesměrovává na `/no-workspace`.
 */
export function DangerZoneView({ workspace, action, initialState }: DangerZoneViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const [open, setOpen] = useState(false);

  return (
    // Karta jako každá jiná, jen s rámečkem v barvě nebezpečí. Ani tady žádný
    // stín: kartu odděluje hairline rámeček, tady prostě červený. Rádius je
    // `--radius-surface` (10 px), ne `rounded-lg` z výchozí škály Tailwindu.
    <Card aria-labelledby="general-danger" className="border-danger">
      <CardTitle>
        <span id="general-danger">{t('general.danger.title')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('general.danger.body')}</p>

      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      <form ref={formRef} action={formAction} className="flex flex-col items-start">
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
          onConfirm={() => {
            // `requestSubmit()` čte FormData synchronně, teprve pak se dialog
            // zavírá. Bez zavření by po odmítnutí ze serveru zůstal viset nad
            // stránkou a překryl by vysvětlení, proč se smazání neprovedlo.
            formRef.current?.requestSubmit();
            setOpen(false);
          }}
          labels={confirmLabels}
        />
      </form>
    </Card>
  );
}

/** Obálka, která sekci dodá serverovou akci, aby ji stránka nemusela znát. */
export function DangerZone({ workspace }: { workspace: Workspace }) {
  return <DangerZoneView workspace={workspace} action={deleteWorkspaceAction} />;
}
