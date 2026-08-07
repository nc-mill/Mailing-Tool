'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { BulkRemovalAction, runBulkRemoval } from '@/lib/ui/bulk-removal';
import { deleteNameOverrideAction } from './actions';
import { NameOverrideDialog } from './name-override-dialog';
import { useContactsTableLabels } from './table-labels';

export type NameOverrideRow = {
  id: string;
  kind: 'first' | 'last';
  /** Normalizovaný tvar jména, tedy bez diakritiky a malými písmeny. */
  nameKey: string;
  gender: 'female' | 'male' | 'unknown' | null;
  vocative: string | null;
  note: string | null;
};

/**
 * SLOVNÍK PŘEPISŮ JMEN.
 *
 * Tabulka existuje kvůli tomu, co se do slovníku dostane omylem. Zapisuje se do
 * něj z fronty kontroly oslovení volbou „uložit i pro budoucí kontakty", a do
 * 7. 8. 2026 nebyla druhá strana: překlep v pátém pádu se tiše uplatňoval na
 * všechny budoucí kontakty téhož jména a nešlo ho ani najít, natož opravit.
 * Je to táž vada, jakou měla vlastní pole kontaktu, proto stejný tvar
 * obrazovky.
 *
 * ÚPRAVA A ZALOŽENÍ JSOU JEDEN DIALOG, protože na serveru jsou jedna operace:
 * `POST /name-overrides` je upsert podle dvojice `kind` a klíč jména. Dva
 * dialogy by předstíraly rozdíl, který v datech není.
 */
export function NameOverridesTable({
  workspaceId,
  overrides,
}: {
  /** Projekt pro zápis a smazání. Bez něj API vrátí 404. */
  workspaceId: string;
  overrides: NameOverrideRow[];
}) {
  const t = useTranslations('contacts.nameOverrides');
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();
  const labels = useContactsTableLabels({
    selectRow: t('name'),
    selectAllOnPage: t('title'),
    // Pruh výběru nesmí nad přepisy jmen mluvit o kontaktech.
    selectionWording: 'generic',
  });
  const [editing, setEditing] = useState<NameOverrideRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NameOverrideRow | null>(null);
  /*
   * Výběr řádků. `DataTable` kreslí zaškrtávátka VŽDYCKY a vypnout se nedají, takže
   * je tahle obrazovka měla od začátku, jenže výběr nikam nevedl: pruh nad tabulkou
   * uměl jedině vybrat všechno a zase to zrušit. Slovník přepisů je přitom místo,
   * kde se hromadné mazání hodí nejvíc: zapisuje se do něj po jednom z kontroly
   * oslovení, takže se snadno nasype dvacet překlepů naráz.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** `clearToken` pro tabulku: režim „vybráno všech N" bydlí uvnitř ní. */
  const [clearedSelections, setClearedSelections] = useState(0);

  /**
   * Hromadné smazání označených přepisů.
   *
   * Smazat jde KAŽDÝ přepis, žádný stav to neomezuje, takže se tu nic nepřeskakuje
   * a věta o přeskočených řádcích se nevykresluje. Není to nevratná ztráta:
   * týž přepis jde kdykoli založit znovu, proto se tu ani netvrdí opak.
   */
  const selected = overrides.filter((row) => selectedIds.includes(row.id));

  async function deleteSelected(): Promise<{ failed: number; detail: string | null }> {
    const { failedIds, detail } = await runBulkRemoval(
      selected.map((row) => row.id),
      (id) => deleteNameOverrideAction({ workspaceId, id }),
    );
    router.refresh();
    if (failedIds.length === 0) {
      toast.success(t('bulkDone', { count: selected.length }));
      // Výběr se ruší JEN po úspěchu: po chybě by uživatel přišel o odklikanou práci.
      setSelectedIds([]);
      setClearedSelections((count) => count + 1);
      return { failed: 0, detail: null };
    }
    // Ve výběru zůstane jen to, co se smazat nepodařilo. Je to jediné, s čím se dá
    // dál něco dělat, a zároveň to sedí s tím, co je po obnovení ještě v tabulce.
    setSelectedIds(failedIds);
    setClearedSelections((count) => count + 1);
    return { failed: failedIds.length, detail };
  }

  const genderLabel = (gender: NameOverrideRow['gender']): string => {
    if (gender === 'female') return t('genderFemale');
    if (gender === 'male') return t('genderMale');
    if (gender === 'unknown') return t('genderNeutral');
    return t('unset');
  };

  if (overrides.length === 0) {
    return (
      <>
        <EmptyState
          variant="first"
          title={t('emptyTitle')}
          explanation={t('emptyBody')}
          actions={[{ label: t('create'), onClick: () => setCreating(true) }]}
        />
        <NameOverrideDialog
          open={creating}
          onOpenChange={setCreating}
          workspaceId={workspaceId}
          override={null}
          onSaved={() => router.refresh()}
        />
      </>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t('scopeHint')}</p>

      <div>
        <Button
          variant="primary"
          data-testid="create-name-override"
          onClick={() => setCreating(true)}
        >
          {t('create')}
        </Button>
      </div>

      <DataTable
        tableId="name-overrides"
        caption={t('title')}
        rows={overrides}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: overrides.length, precision: 'exact' }}
        selection={{
          selectedIds: selected.map((row) => row.id),
          onSelectionChange: setSelectedIds,
          clearToken: clearedSelections,
        }}
        bulkActions={
          <BulkRemovalAction
            testId="name-overrides-bulk"
            removable={selected.length}
            labels={{
              action: t('bulkDelete', { count: selected.length }),
              nothing: t('bulkNothing'),
              title: t('bulkTitle', { count: selected.length }),
              // Tytéž tři věty jako u jednoho přepisu, protože se počtem nemění:
              // kontakty, kterých se přepis dotkl, zůstávají a jméno se vrátí
              // do kontroly oslovení.
              explanation: [
                t('bulkExplanation'),
                t('deleteConsequenceContacts'),
                t('deleteConsequenceQueue'),
              ],
              submit: t('bulkDelete', { count: selected.length }),
              submitting: t('bulkSubmitting'),
              cancel: t('deleteCancel'),
              failed: ({ failed, detail }) =>
                t('bulkFailed', { count: failed, detail: detail ?? '' }),
            }}
            onConfirm={deleteSelected}
          />
        }
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          { id: 'name', header: t('name'), cell: (row) => row.nameKey },
          {
            id: 'kind',
            header: t('kind'),
            cell: (row) => (row.kind === 'first' ? t('kindFirst') : t('kindLast')),
          },
          { id: 'gender', header: t('gender'), cell: (row) => genderLabel(row.gender) },
          // Pátý pád je to, kvůli čemu se sem uživatel dívá: právě v něm bývá
          // překlep, který se propisuje do oslovení každého dalšího kontaktu.
          { id: 'vocative', header: t('vocative'), cell: (row) => row.vocative ?? t('unset') },
          { id: 'note', header: t('note'), cell: (row) => row.note ?? '' },
          {
            id: 'action',
            header: t('columnAction'),
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  data-testid={`edit-name-override-${row.nameKey}`}
                  onClick={() => setEditing(row)}
                >
                  {t('edit')}
                </Button>
                <Button
                  variant="destructive"
                  data-testid={`delete-name-override-${row.nameKey}`}
                  onClick={() => setDeleting(row)}
                >
                  {t('delete')}
                </Button>
              </span>
            ),
          },
        ]}
      />

      <NameOverrideDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        override={null}
        onSaved={() => router.refresh()}
      />

      <NameOverrideDialog
        open={editing !== null}
        onOpenChange={(open) => setEditing(open ? editing : null)}
        workspaceId={workspaceId}
        override={editing}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => setDeleting(open ? deleting : null)}
        level="N2"
        // Výjimka se smaže, oslovení se vrátí k automatickému tvaru a stejná
        // výjimka jde kdykoli zadat znovu. Nic z projektu nemizí.
        destructive={false}
        title={t('deleteTitle', { name: deleting?.nameKey ?? '' })}
        // Obojí musí zaznít, protože obojí uživatel čeká špatně: smazání se
        // NEDOTKNE kontaktů, které přepis už ovlivnil, a jméno se do fronty
        // kontroly oslovení zase vrátí.
        consequences={[t('deleteConsequenceContacts'), t('deleteConsequenceQueue')]}
        // Není to nevratná akce: týž přepis jde založit znovu. Tvrdit opak by
        // z varování udělalo strašáka a příště by ho nikdo nečetl. Dialog tu
        // přesto je, protože oslovení odchází ven ke koncovým příjemcům.
        irreversible={false}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('deleteCancel')}
        labels={confirmLabels}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteNameOverrideAction({ workspaceId, id: deleting.id });
          if (result.status === 'success') {
            setDeleting(null);
            router.refresh();
          }
        }}
      />
    </section>
  );
}
