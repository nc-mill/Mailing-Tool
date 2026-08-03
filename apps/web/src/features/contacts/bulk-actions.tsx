'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Select, SelectItem } from '@mlain/ui/components/select';
// K5 z 13.1 části 6: fronta oznámení, odpočet u „Vrátit zpět", chyba se nezavírá sama.
import { useToast } from '@mlain/ui/patterns/toast';
import { BulkDeleteDialog } from './bulk-delete-dialog';
import { bulkDeleteContactsAction, bulkTagContactsAction, exportContactsAction } from './actions';
import type { BulkScope } from './actions';
import { useFilterChips } from './filter-chips';
import type { ContactListFilters, FilterNames } from './filters';
import type { Selection } from './contacts-table';

export type ContactsBulkActionsProps = {
  /**
   * Projekt pro serverové akce. Bez něj jde požadavek bez hlavičky `X-Workspace-Id`,
   * RLS nevrátí ani řádek a hromadné smazání i export skončí na 404.
   */
  workspaceId: string;
  selection: Selection;
  filters: ContactListFilters;
  names: FilterNames;
  /** Štítky projektu pro rychlé přiřazení. Prázdné pole nabídku štítků skryje. */
  tags?: { id: string; name: string }[];
};

export function ContactsBulkActions({
  workspaceId,
  selection,
  filters,
  names,
  tags = [],
}: ContactsBulkActionsProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const chips = useFilterChips()(filters, names);

  // Filtr se v dialogu opakuje jen tehdy, když se maže „vše odpovídající filtru".
  // U výběru na stránce žádný filtr o rozsahu nerozhoduje a věta by mátla.
  const filterDescription =
    selection.mode === 'allMatching' && chips.length > 0 ? format.list(chips) : null;

  const scope: BulkScope =
    selection.mode === 'allMatching'
      ? { mode: 'filter', filters }
      : { mode: 'ids', ids: [...selection.ids] };

  async function addTag(tagId: string, tagName: string) {
    // Přidání štítku je vratné a bez vnějšího dopadu (5.6 části 6), proto se hlásí
    // oznámením s odpočtem a nabídkou vrácení, ne dialogem.
    const result = await bulkTagContactsAction({ workspaceId, scope, add: [tagId] });
    if (result.status === 'success') {
      toast.undoable({
        message: t('bulk.tagAdded', { tag: tagName }),
        onUndo: () => {
          void bulkTagContactsAction({ workspaceId, scope, remove: [tagId] }).then(() =>
            router.refresh(),
          );
        },
      });
      router.refresh();
    }
  }

  return (
    <>
      {tags.length > 0 ? (
        <Select
          aria-label={t('bulk.addTag')}
          placeholder={t('bulk.addTag')}
          onValueChange={(tagId: string) => {
            const tag = tags.find((candidate) => candidate.id === tagId);
            if (tag) void addTag(tag.id, tag.name);
          }}
        >
          {tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>
              {tag.name}
            </SelectItem>
          ))}
        </Select>
      ) : null}

      <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
        {t('bulk.delete')}
      </Button>

      <BulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        selection={selection}
        filterDescription={filterDescription}
        onExport={() => exportContactsAction({ workspaceId, scope })}
        onConfirm={async () => {
          const result = await bulkDeleteContactsAction({ workspaceId, scope });
          if (result.status === 'success') {
            // Hromadné smazání běží v jobu contacts.bulk_delete, takže se nehlásí „hotovo",
            // ale „mažeme". Lhát o dokončení by znamenalo, že uživatel obnoví stránku
            // a uvidí kontakty, které podle hlášky už neexistují.
            toast.success(t('bulk.queued', { count: selection.count }));
            router.refresh();
          }
          return result;
        }}
      />
    </>
  );
}
