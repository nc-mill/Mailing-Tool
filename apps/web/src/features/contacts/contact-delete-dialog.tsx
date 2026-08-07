'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { deleteContactAction } from './actions';

/**
 * Okno mazání jednoho kontaktu. JEDNO MÍSTO PRO CELOU DOMÉNU.
 *
 * Vzniklo vytažením z detailu kontaktu, když se totéž mazání nabídlo i v nabídce
 * „…" v řádku seznamu. Zkopírovat ho by znamenalo mít dvě verze výčtu následků,
 * které se při první opravě rozejdou, a přesně tomu se tady vyhýbáme: následky
 * jsou čtyři, jsou doslovné podle 8.8 části 6 a musí být stejné bez ohledu na to,
 * odkud uživatel maže.
 *
 * ÚROVEŇ JE N2, ne N1: smazání se sice 30 dní dá vzít zpět v databázi, ale
 * z rozhraní na to není cesta, takže se ptáme oknem s výčtem následků.
 *
 * NABÍDKA STÁHNOUT DATA PŘED SMAZÁNÍM je podle 6.5 části 6 silnější ochrana než
 * opisování textu. Export si drží volající (`useContactExport`), protože obě
 * obrazovky ho už mají po ruce pro svoje vlastní tlačítko a druhá instance by
 * znamenala druhý dialog průběhu na téže stránce.
 */
export function ContactDeleteDialog({
  workspaceId,
  contactId,
  name,
  open,
  onOpenChange,
  onExport,
  onDeleted,
}: {
  workspaceId: string;
  contactId: string;
  /** Jméno nebo adresa do nadpisu okna, ať je vidět, koho se to týká. */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stažení dat kontaktu před smazáním. Vede na `useContactExport` volajícího. */
  onExport: () => void;
  /** Co se stane po úspěšném smazání: detail odchází na seznam, seznam se obnoví. */
  onDeleted: () => void;
}) {
  const t = useTranslations('contacts');
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      destructive
      title={t('detail.deleteTitle', { name })}
      consequences={[
        t('detail.deleteConsequenceLists'),
        t('detail.deleteConsequenceHistory'),
        t('detail.deleteConsequenceReports'),
        t('detail.deleteConsequenceSuppression'),
      ]}
      extraAction={
        <Button variant="secondary" onClick={onExport}>
          {t('detail.deleteExport')}
        </Button>
      }
      confirmLabel={t('detail.deleteConfirm')}
      cancelLabel={t('detail.deleteCancel')}
      labels={confirmLabels}
      onConfirm={async () => {
        const result = await deleteContactAction({ workspaceId, id: contactId });
        // Neúspěch se HLÁSÍ. Do vytažení sem se chyba mlčky spolkla: okno se zavřelo,
        // kontakt zůstal a uživatel odešel s tím, že smazal. Kód je v hlášce schválně,
        // je to jediné, co se dá u cizí odpovědi napsat pravdivě.
        if (result.status !== 'success') {
          toast.error(t('detail.actionFailed', { code: result.code }));
          return;
        }
        onDeleted();
      }}
    />
  );
}
