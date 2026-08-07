'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';

export type RemoveFromListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Počet označených kontaktů. Musí být v nadpisu, ne jen v liště nad tabulkou. */
  count: number;
  listName: string;
  /**
   * Kolik z označených kontaktů po odhlášení nezůstane v ŽÁDNÉM seznamu.
   *
   * Zadavatel od produktu čeká, že „seznam musí kontakt nějaký mít". Jádro to
   * nevynucuje: `lists` je v `ContactUpsertRequest` nepovinné a žádné minimum tam není,
   * takže kontakt bez jediného seznamu vznikne bez chyby. Akce se proto nezakazuje,
   * ale říká se nahlas, kolika kontaktů se to týká. Nula větu vynechá.
   */
  orphaned?: number;
  onConfirm: () => Promise<void>;
};

/**
 * Potvrzení hromadného odebrání ze seznamu, úroveň **N2**: nadpis s počtem a názvem
 * seznamu, výčet konkrétních následků, potvrdit a ustoupit. Žádné zaškrtnutí ani
 * opisování, to patří až k nevratnému mazání.
 *
 * PROČ DIALOG A NE „VRÁTIT ZPĚT". Lišta má vzor optimistické akce s vrácením u štítků
 * a byl by tu lákavý, jenže odhlášení se vrátit nedá: návrat do seznamu vede podle
 * stavového automatu vždycky přes `pending` a POŠLE ČLOVĚKU POTVRZOVACÍ E-MAIL. Tlačítko
 * „Vrátit zpět" by tedy slibovalo návrat do původního stavu, který neumí, a každé
 * omylem kliknuté vrácení by skončilo poštou v cizí schránce. Krok navíc patří PŘED
 * akci, ne po ní.
 *
 * `irreversible` je schválně vypnuté: věta „Tohle nejde vzít zpět" sem nepatří, protože
 * kontakt ani jeho historie nikam nemizí. Nevratný je jen ten jeden krok, a to říká
 * poslední odrážka následků vlastními slovy.
 */
export function RemoveFromListDialog({
  open,
  onOpenChange,
  count,
  listName,
  orphaned = 0,
  onConfirm,
}: RemoveFromListDialogProps) {
  const t = useTranslations('contacts');
  const labels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      // Kontakty zůstávají v projektu, mění se jen členství v seznamu.
      destructive={false}
      title={t('bulk.removeFromListTitle', { count, list: listName })}
      consequences={[
        t('bulk.removeFromListConsequenceSending'),
        t('bulk.removeFromListConsequenceScope'),
        t('bulk.removeFromListConsequenceHistory'),
        // Věta o kontaktech bez seznamu stojí PŘED obecným „vrátit se dá jen novým
        // přihlášením", protože je konkrétní a týká se právě téhle akce.
        ...(orphaned > 0 ? [t('bulk.removeFromListConsequenceOrphaned', { count: orphaned })] : []),
        t('bulk.removeFromListConsequenceBack'),
      ]}
      irreversible={false}
      confirmLabel={t('bulk.removeFromListAction', { count })}
      cancelLabel={t('bulk.cancel')}
      onConfirm={async () => {
        await onConfirm();
        onOpenChange(false);
      }}
      labels={labels}
    />
  );
}
