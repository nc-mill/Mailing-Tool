'use client';

import { Button } from '@mlain/ui/components/button';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  TemplateDeleteDialog,
  useDeleteFailureText,
  type DeletedTemplate,
} from './template-delete-dialog';

export { useDeleteFailureText };
export type { DeletedTemplate };

/**
 * Smazání šablony z pruhu nad editorem: popsané tlačítko a k němu okno.
 *
 * OKNO SI TENHLE SOUBOR NEKRESLÍ. Potvrzení včetně výčtu následků bydlí od
 * 6. 8. 2026 v `TemplateDeleteDialog`, protože se maže i z řádkové nabídky „…"
 * v knihovně, a ta spouštěč tohohle tvaru mít nemůže: položka nabídky je
 * `[role="menuitem"]`, ne tlačítko s oknem uvnitř. Dva výčty následků nad jednou
 * akcí by se časem rozešly.
 *
 * IKONOVÝ VZHLED TU BÝVAL A ZMIZEL. Do 6. 8. 2026 uměla komponenta i ikonu koše
 * pro řádek knihovny; tam ji vystřídala nabídka „…", takže by tu zůstal mrtvý
 * kód se svým vlastním `aria-label` a testovací značkou.
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
  const failureText = useDeleteFailureText();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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

      <TemplateDeleteDialog
        workspaceId={workspaceId}
        templateId={templateId}
        name={name}
        open={open}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
        onFailed={setFailure}
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
