'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog, type ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';

/**
 * Popisky potvrzovacího dialogu z obecného katalogu, ne z domény formulářů.
 *
 * Bydlí tady, protože je potřebují obě místa, ze kterých se formulář maže:
 * editor formuláře i řádková nabídka „…" v seznamu.
 */
export function useFormConfirmLabels(identifier: string): ConfirmDialogLabels {
  const t = useTranslations('common.confirm');
  return {
    irreversible: t('irreversible'),
    whatHappens: t('whatHappens'),
    notYetConfirmed: t('notYetConfirmed'),
    notYetTyped: t('notYetTyped', { identifier }),
    typeToConfirmMismatch: t('typeToConfirmMismatch'),
    filterInWords: (filter: string) => t('filterInWords', { filter }),
  };
}

/**
 * Okno mazání formuláře BEZ VLASTNÍHO SPOUŠTĚČE.
 *
 * PROČ SAMOSTATNÝ SOUBOR. Od 6. 8. 2026 se maže ze dvou míst: z pruhu akcí
 * v editoru formuláře a z řádkové nabídky „…" v seznamu. Nabídka spouštěč
 * s oknem uvnitř mít nemůže, protože se obsah rozbalené nabídky při volbě
 * odpojí z DOM. Bez tohohle souboru by vznikl DRUHÝ výčet následků, který by
 * se s tím prvním časem rozešel.
 *
 * ÚROVEŇ N2: okno s následky, bez zaškrtávátka a bez opisování jména. Věta
 * o nevratnosti tu SCHVÁLNĚ NENÍ jako nálepka; váhu nese třetí následek, který
 * říká, že na dočasné zastavení je pozastavení, ne mazání.
 */
export function FormDeleteDialog({
  form,
  open,
  onOpenChange,
  onConfirm,
}: {
  form: { name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const tf = useTranslations('forms.editor');
  const tc = useTranslations('common.actions');
  const labels = useFormConfirmLabels(form.name);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      title={tf('deleteTitle', { name: form.name })}
      consequences={[
        tf('deleteConsequenceForm'),
        tf('deleteConsequenceSubmissions'),
        tf('deleteConsequenceAlternative'),
      ]}
      confirmLabel={tf('deleteConfirm')}
      cancelLabel={tc('cancel')}
      labels={labels}
      onConfirm={onConfirm}
    />
  );
}
