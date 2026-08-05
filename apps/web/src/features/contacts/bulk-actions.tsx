'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Select, SelectItem } from '@mlain/ui/components/select';
// K5 z 13.1 části 6: fronta oznámení, odpočet u „Vrátit zpět", chyba se nezavírá sama.
import { useToast } from '@mlain/ui/patterns/toast';
import { BulkDeleteDialog } from './bulk-delete-dialog';
import { bulkDeleteContactsAction, bulkTagContactsAction } from './actions';
import { ContactExportDialog, exportAndDownload, useContactExport } from './contact-export';
import { emailsToAudience, filtersToAudience } from './export-audience';
import { confirmContactsAction } from './confirm-actions';
import { addContactsToListAction, removeContactsFromListAction } from './list-actions';
import { RemoveFromListDialog } from './remove-from-list-dialog';
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
  /**
   * Adresy zaškrtnutých kontaktů. Publikum exportu umí vyjmenovat kontakty jen
   * e-mailem, id do něj nepatří; podrobně u `emailsToAudience`.
   */
  selectedEmails?: string[];
  /**
   * Seznamy projektu pro hromadné přidání. Prázdné pole nabídku seznamů skryje.
   *
   * Nabídka bez tlačítka tu do téhle chvíle nebyla vůbec, ačkoliv popisky
   * `bulk.addToList` a `bulk.removeFromList` v katalozích ležely od začátku.
   */
  lists?: { id: string; name: string }[];
};

export function ContactsBulkActions({
  workspaceId,
  selection,
  filters,
  names,
  tags = [],
  lists = [],
  selectedEmails = [],
}: ContactsBulkActionsProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * Vybraný seznam. Rozbalovátko zůstává neřízené a stav je jen jeho ozvěna: kdyby se
   * `value` dopisovalo až po první volbě, přepnul by se prvek z neřízeného na řízený
   * a React by na to nadával. Tlačítko potřebuje znát jen ID, ne ovládat nabídku.
   */
  const [listId, setListId] = useState<string | null>(null);
  const [addingToList, setAddingToList] = useState(false);
  const [removingFromList, setRemovingFromList] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const contactExport = useContactExport(workspaceId);

  const chips = useFilterChips()(filters, names);

  // Filtr se v dialogu opakuje jen tehdy, když se maže „vše odpovídající filtru".
  // U výběru na stránce žádný filtr o rozsahu nerozhoduje a věta by mátla.
  const filterDescription =
    selection.mode === 'allMatching' && chips.length > 0 ? format.list(chips) : null;

  const scope: BulkScope =
    selection.mode === 'allMatching'
      ? { mode: 'filter', filters }
      : { mode: 'ids', ids: [...selection.ids] };

  /**
   * Publikum exportu. U výběru je to výčet adres, u „vše odpovídající filtru" tentýž
   * filtr, jaký je v URL. Odmítnutí (hledaný výraz, přes tisíc adres) se nese dál
   * a dialog z něj napíše, co udělat místo toho.
   */
  const exportOutcome =
    selection.mode === 'allMatching'
      ? filtersToAudience(filters)
      : emailsToAudience(selectedEmails);

  async function addTag(tagId: string, tagName: string) {
    // Přidání štítku je vratné a bez vnějšího dopadu (5.6 části 6), proto se hlásí
    // oznámením s odpočtem a nabídkou vrácení, ne dialogem.
    const result = await bulkTagContactsAction({ workspaceId, scope, add: [tagId] });
    // Chyba se do téhle chvíle spolkla: kliknutí neudělalo nic a rozhraní o tom mlčelo.
    if (result.status === 'error') {
      toast.error(t('bulk.tagFailed', { detail: result.code }));
      return;
    }
    toast.undoable({
      message: t('bulk.tagAdded', { tag: tagName }),
      onUndo: () => {
        void bulkTagContactsAction({ workspaceId, scope, remove: [tagId] }).then((undone) => {
          if (undone.status === 'error') {
            toast.error(t('bulk.tagFailed', { detail: undone.code }));
            return;
          }
          router.refresh();
        });
      },
    });
    router.refresh();
  }

  /**
   * Hromadné přidání do seznamu.
   *
   * JEN NAD OZNAČENÝMI ŘÁDKY, ze stejného důvodu jako povýšení na potvrzené: přihlašovací
   * endpoint bere adresy, ne filtr, a výběr v tabulce je stejně vždycky režim `ids`.
   *
   * Není to optimistická akce s nabídkou vrácení jako štítek. Přihlášení do seznamu
   * mění to, komu se smí posílat, a u odhlášeného kontaktu odešle potvrzovací e-mail
   * ven ze systému. Vzít zpět se dá odhlášení, ne odeslaný e-mail, takže se hlásí
   * až SKUTEČNÝ výsledek od serveru.
   *
   * ODHLÁŠENÝ KONTAKT SE MEZI PŘÍJEMCE TIŠE NEVRÁTÍ. Akce úmyslně neposílá prohlášení
   * o doloženém souhlasu, takže ho stavový automat pošle přes `pending` s potvrzovacím
   * odkazem. Rozhraní to musí říct nahlas, jinak by uživatel viděl „přidáno" a čekal
   * příjemce, kteří v rozesílce nebudou.
   */
  async function addToList() {
    if (listId === null || selection.mode !== 'ids') return;
    const list = lists.find((candidate) => candidate.id === listId);
    if (list === undefined) return;

    setAddingToList(true);
    const result = await addContactsToListAction({
      workspaceId,
      listId,
      ids: [...selection.ids],
    });
    setAddingToList(false);

    if (result.status === 'error') {
      toast.error(t('bulk.addToListFailed', { detail: result.code }));
      return;
    }

    const { confirmed, pending, already, blocked } = result.summary;
    const message = t('bulk.addToListDone', {
      list: list.name,
      added: confirmed + pending,
      already,
    });
    const notes = [
      pending > 0 ? t('bulk.addToListPending', { count: pending }) : '',
      blocked > 0 ? t('bulk.addToListBlocked', { count: blocked }) : '',
    ]
      .filter((note) => note !== '')
      .join(' ');

    // Chybová barva u výsledku, kde se něco opravdu přidalo, je schválně: oznámení
    // chybové barvy se nezavírá samo a přeskočený kontakt je informace, kterou
    // uživatel přehlédnout nesmí.
    if (blocked > 0) toast.error(message, notes);
    else if (notes !== '') toast.success(message, notes);
    else toast.success(message);

    router.refresh();
  }

  /**
   * Hromadné odebrání ze seznamu, tedy odhlášení. Potvrzuje se dialogem, ne nabídkou
   * vrácení: proč, je vysvětlené u `RemoveFromListDialog`.
   *
   * Hlásí se stejně poctivě jako přidání: kolik se opravdu odhlásilo a u kolika nebylo
   * co měnit, protože v seznamu vůbec nebyli nebo v něm odhlášení už byli.
   */
  async function removeFromList() {
    if (listId === null || selection.mode !== 'ids') return;
    const list = lists.find((candidate) => candidate.id === listId);
    if (list === undefined) return;

    setRemovingFromList(true);
    const result = await removeContactsFromListAction({
      workspaceId,
      listId,
      ids: [...selection.ids],
    });
    setRemovingFromList(false);

    if (result.status === 'error') {
      toast.error(t('bulk.removeFromListFailed', { detail: result.code }));
      return;
    }

    const { unsubscribed, unchanged } = result.summary;
    const message = t('bulk.removeFromListDone', {
      list: list.name,
      unsubscribed,
      unchanged,
    });
    if (unchanged > 0) {
      toast.success(message, t('bulk.removeFromListNothing', { count: unchanged }));
    } else {
      toast.success(message);
    }

    router.refresh();
  }

  /**
   * Hromadné povýšení na potvrzené.
   *
   * JEN NAD OZNAČENÝMI ŘÁDKY, ne nad „vše odpovídající filtru": akce jde po jednom
   * kontaktu (hromadný endpoint na změnu stavu v API není) a nad statisíci řádky
   * by to byl statisíc požadavků. Výběr v tabulce je stejně vždycky režim `ids`,
   * viz komentář u typu `Selection`.
   *
   * Není to optimistická akce s nabídkou vrácení jako štítek: povýšení zapisuje
   * souhlas a potvrzuje přihlášení do seznamů, tedy má vnější dopad na to, komu
   * se smí posílat. Hlásí se proto až SKUTEČNÝ výsledek od serveru.
   *
   * ŽÁDNÝ KONTAKT SE UŽ NEPŘESKAKUJE. Dřív se odhlášený, odražený a stěžující si kontakt
   * počítal jako „beze změny", protože ho zápis mlčky nechal být. Server má dnes pro
   * výslovné rozhodnutí správce vlastní cestu, takže povýšení projde vždycky. Zůstala
   * jediná výhrada, a ta se hlásí zvlášť: u části kontaktů může na adrese ZŮSTAT blokace,
   * kterou sundat nesmíme (stížnost, trvalý odraz), a těm se pořád nic neodešle.
   */
  async function confirmSelected() {
    if (selection.mode !== 'ids') return;
    setConfirming(true);
    const result = await confirmContactsAction({ workspaceId, ids: [...selection.ids] });
    setConfirming(false);
    if (result.status === 'error') {
      toast.error(t('confirmState.failed', { detail: result.code }));
      return;
    }

    const blocked = result.outcomes.filter(
      (outcome) => outcome.suppressionBlocking !== null,
    ).length;

    if (blocked > 0) {
      // Chybová barva u výsledku, kde se stav opravdu změnil, je schválně: oznámení
      // chybové barvy se nezavírá samo, a tohle je informace, kterou uživatel přehlédnout
      // nesmí. Kontakty jsou potvrzené a přesto se jim neodešle.
      toast.error(
        t('confirmState.doneWithBlocked', { confirmed: result.outcomes.length, blocked }),
      );
    } else {
      toast.success(t('confirmState.done', { count: result.outcomes.length }));
    }
    router.refresh();
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={confirming || selection.mode !== 'ids'}
        onClick={() => {
          void confirmSelected();
        }}
      >
        {confirming ? t('confirmState.confirming') : t('confirmState.bulkAction')}
      </Button>

      {/* `w-56` přebíjí výchozí `w-full` v `Select`. Lišta je flex s zalomením, takže
          rozbalovátko na celou šířku zabere celý řádek a vytlačí tlačítka pod sebe. */}
      {tags.length > 0 ? (
        <Select
          className="w-56"
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

      {/* Nabídka seznamů a tlačítko k ní patří k sobě. Bez tlačítka byla nabídka slepá:
          uživatel v ní vybral „Newsletter" a neměl co zmáčknout. */}
      {lists.length > 0 ? (
        <>
          <Select
            className="w-56"
            aria-label={t('bulk.addToList')}
            placeholder={t('bulk.addToList')}
            onValueChange={setListId}
          >
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            variant="secondary"
            disabled={addingToList || listId === null || selection.mode !== 'ids'}
            onClick={() => {
              void addToList();
            }}
          >
            {addingToList
              ? t('bulk.addToListRunning')
              : t('bulk.addToListAction', { count: selection.count })}
          </Button>
          {/* Odebrání stojí vedle přidání schválně: je to táž nabídka seznamů a uživatel
              nemá hledat opačnou akci na jiném místě obrazovky. */}
          <Button
            variant="secondary"
            disabled={removingFromList || listId === null || selection.mode !== 'ids'}
            onClick={() => setRemoveOpen(true)}
          >
            {removingFromList
              ? t('bulk.removeFromListRunning')
              : t('bulk.removeFromListAction', { count: selection.count })}
          </Button>
        </>
      ) : null}

      {/* Export výběru. Do 5. 8. 2026 se dal výběr vyvézt jedině z dialogu mazání,
          tedy jen tomu, kdo ho chtěl smazat, a i tam skončil na 422. */}
      <Button
        variant="secondary"
        onClick={() =>
          void contactExport.start({
            title: t('bulk.exportTitle'),
            fileName: t('list.exportFileName'),
            outcome: exportOutcome,
          })
        }
      >
        {t('bulk.export', { count: selection.count })}
      </Button>

      <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
        {t('bulk.delete')}
      </Button>

      <RemoveFromListDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        count={selection.count}
        listName={lists.find((candidate) => candidate.id === listId)?.name ?? ''}
        onConfirm={removeFromList}
      />

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />

      <BulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        selection={selection}
        filterDescription={filterDescription}
        // Dialog o výsledku informuje sám („Soubor je stažený. Teď můžete kontakty
        // smazat."), takže se tu nepoužívá dialog s tlačítkem: druhé okno nad dialogem
        // mazání by jen překáželo. Slib „stažený" je od téhle chvíle pravdivý.
        onExport={() =>
          exportAndDownload({
            workspaceId,
            locale,
            outcome: exportOutcome,
            fileName: t('list.exportFileName'),
          })
        }
        onConfirm={async () => {
          const result = await bulkDeleteContactsAction({ workspaceId, scope });
          if (result.status === 'success') {
            // Hromadné smazání běží v jobu contacts.bulk_delete, takže se nehlásí „hotovo",
            // ale „mažeme". Lhát o dokončení by znamenalo, že uživatel obnoví stránku
            // a uvidí kontakty, které podle hlášky už neexistují.
            toast.success(t('bulk.queued', { count: selection.count }));
            router.refresh();
          } else {
            // Dialog se zavírá i po chybě, takže bez tohohle oznámení zůstal uživatel
            // u nezměněné tabulky a bez jediného slova o tom, že se mazání nespustilo.
            toast.error(t('bulk.deleteFailed', { detail: result.code }));
          }
          return result;
        }}
      />
    </>
  );
}
