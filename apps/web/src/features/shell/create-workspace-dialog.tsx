'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { AuthProblem } from '@/features/auth/action-problem';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { SubmitButton } from '@/lib/forms/submit-button';

export type CreateWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Jen pro testy, aby se dal vykreslit stav po chybě bez volání akce. */
  initialState?: ActionState | undefined;
};

/**
 * Založení dalšího projektu. Dialog, ne stránka: uživatel do něj jde z
 * přepínače projektů a po dokončení pokračuje v práci, ne v průvodci.
 *
 * Formulář má JEDINÉ pole. Jazyk a časové pásmo se dají doplnit v nastavení
 * projektu a zeptat se na ně tady by znamenalo tři otázky místo jedné hned
 * v okamžiku, kdy uživatel chce jen začít. `POST /api/v1/workspaces` obojí
 * bere jako nepovinné a doplní výchozí hodnoty instalace.
 *
 * Úspěch dialog NEZAVÍRÁ a ani nemá: `createWorkspaceAction` po založení
 * přesměruje na Přehled nového projektu, takže se celá skořápka vykreslí
 * znovu a dialog zmizí s ní. Kdyby se zavíral sám, blikl by na okamžik starý
 * projekt v hlavičce.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  action,
  initialState,
}: CreateWorkspaceDialogProps) {
  const t = useTranslations('common');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);

  const nameError = state.status === 'error' ? state.fieldErrors['name']?.[0] : undefined;
  // Chyba pole se ukazuje u pole. Cokoliv jiného (413, 503, chyba sítě) je
  // chyba celé akce a patří nad tlačítka, ne pod jediný vstup.
  const problem = state.status === 'error' && nameError === undefined ? state.problem : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <form action={formAction}>
        <DialogTitle>{t('shell.newProject')}</DialogTitle>
        <DialogBody>
          <p className="text-text-muted">{t('shell.newProjectLead')}</p>
          <IdempotencyField />
          <Field label={t('shell.newProjectName')} {...(nameError ? { error: nameError } : {})}>
            <Input
              name="name"
              data-testid="new-workspace-name"
              autoComplete="organization"
              defaultValue={state.status === 'error' ? (state.values?.['name'] ?? '') : ''}
            />
          </Field>
          {problem ? <AuthProblem problem={problem} /> : null}
        </DialogBody>
        <DialogFooter
          retreat={
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
          }
          confirm={
            <SubmitButton
              label={t('shell.newProjectSubmit')}
              pendingLabel={t('shell.newProjectPending')}
            />
          }
        />
      </form>
    </Dialog>
  );
}
