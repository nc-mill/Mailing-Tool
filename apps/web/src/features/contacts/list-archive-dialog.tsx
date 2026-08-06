'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { archiveListAction } from './actions';

/**
 * Okno archivace seznamu. JEDNO MÍSTO PRO CELOU DOMÉNU, stejně jako u mazání kontaktu.
 *
 * ARCHIVACE JE TO, ČEMU SE JINDE ŘÍKÁ SMAZÁNÍ: jiné mazání seznamu produkt nemá,
 * `DELETE /lists/{id}` nastaví `deleted_at` a seznam tím zmizí ze všech nabídek.
 * Dřív se akce prováděla rovnou z `onClick` ikony a obrazovka hned odešla pryč,
 * takže jedno kliknutí vedle znamenalo ztrátu přístupu k seznamu bez jediné otázky.
 *
 * ÚROVEŇ JE N2 podle os z 6.1: rozsah 0 (jeden seznam), obnovitelnost 1 (data
 * zůstávají v databázi, ale z rozhraní na ně cesta zpět není), vnější dopad 2
 * (formulář zapisující do seznamu začne koncovým lidem odmítat přihlášení).
 * Součet 3 je N2, tedy okno s výčtem následků, bez zaškrtávátka a bez opisování.
 *
 * NÁSLEDKY JSOU OVĚŘENÉ V KÓDU, ne odhadnuté:
 *   - `archive()` v `repo/lists.ts` nastaví `deleted_at` a shodí `is_default`,
 *     s přihlášeními ani souhlasy nedělá nic;
 *   - `byId`/`list` bez `includeArchived` archivovaný seznam nevrátí, takže zmizí
 *     z nabídek kampaní, formulářů i přidání kontaktu;
 *   - `subscribe()` dostane z portu `findList` null a skončí chybou 404, takže
 *     nová přihlášení seznam přestane přijímat.
 */
export function ListArchiveDialog({
  workspaceId,
  listId,
  name,
  isDefault,
  open,
  onOpenChange,
  onArchived,
}: {
  workspaceId: string;
  listId: string;
  /** Název seznamu do nadpisu okna, ať je vidět, kterého se to týká. */
  name: string;
  /** Výchozí seznam ztrácí archivací i tuhle roli, takže se následek přidá navíc. */
  isDefault: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Co se stane po úspěšné archivaci: detail odchází na přehled seznamů. */
  onArchived: () => void;
}) {
  const t = useTranslations('contacts');
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      title={t('lists.archiveTitle', { name })}
      consequences={[
        t('lists.archiveConsequenceMenus'),
        t('lists.archiveConsequenceSignups'),
        t('lists.archiveConsequenceHistory'),
        ...(isDefault ? [t('lists.archiveConsequenceDefault')] : []),
      ]}
      confirmLabel={t('lists.archiveConfirm')}
      cancelLabel={t('lists.archiveCancel')}
      labels={confirmLabels}
      onConfirm={async () => {
        const result = await archiveListAction({ workspaceId, id: listId });
        // Neúspěch se HLÁSÍ a obrazovka zůstává. Odejít na přehled po chybě by
        // znamenalo, že uživatel odchází s tím, že archivoval, a seznam přitom stojí.
        if (result.status !== 'success') {
          toast.error(t('lists.archiveFailed', { code: result.code }));
          return;
        }
        onArchived();
      }}
    />
  );
}
