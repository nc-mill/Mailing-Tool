'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
// K1 z 13.1 části 6: výběr přežije přestránkování a je vidět jeho velikost, kurzorové
// stránkování bez čísel stránek, virtualizace od 100 řádků, sticky hlavička.
import { DataTable, type DataTableColumn } from '@mlain/ui/patterns/data-table';
import { ContactsBulkActions } from './bulk-actions';
import { ConfirmContactButton } from './confirm-contact-button';
import { ContactExportDialog, useContactExport } from './contact-export';
import { ContactsEmptyState, ContactsFilteredEmptyState } from './contacts-empty-state';
import { filtersToAudience } from './export-audience';
import { ContactStatusBadges } from './status-badges';
import { GreetingBadge } from './greeting-badge';
import type { GreetingStatusInput } from './greeting-status';
import { describeContactState } from './contact-state';
import { useFilterChips } from './filter-chips';
import {
  contactsHref,
  hasAnyFilter,
  type ContactListFilters,
  type ContactStatus,
  type FilterNames,
} from './filters';
import { useContactsTableLabels } from './table-labels';

export type ContactRow = {
  id: string;
  email: string;
  name: string | null;
  /**
   * Stav oslovení. Do téhle chvíle seznam pátý pád vůbec neukazoval, takže se
   * kontakt s tvarem „Petr" tvářil stejně jako kontakt s tvarem „Petře" a rozdíl
   * se projevil až v odeslané kampani.
   */
  greeting: GreetingStatusInput;
  status: ContactStatus;
  processing_restricted: boolean;
  snooze_until: string | null;
  anonymized_at: string | null;
  lists: string[];
  tags: string[];
  created_at: string;
};

export type ContactsTableProps = {
  basePath: string;
  /** Projekt pro hromadné akce. Bez něj běží jejich požadavky mimo kontext projektu. */
  workspaceId: string;
  rows: ContactRow[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  /** Z GET /api/v1/contacts/count. null znamená, že se počet nepodařilo zjistit. */
  total: { count: number; precision: 'exact' | 'estimated' } | null;
  filters: ContactListFilters;
  names: FilterNames;
  /** Kurzor z odkazu přestal platit, ukazuje se první stránka stejného filtru. */
  cursorInvalid?: boolean;
  /** Štítky projektu pro hromadné přiřazení. Prázdné pole nabídku štítků skryje. */
  tags?: { id: string; name: string }[];
  /** Seznamy projektu pro hromadné přidání. Prázdné pole nabídku seznamů skryje. */
  lists?: { id: string; name: string }[];
  /**
   * Cesta do fronty „Kontrola oslovení" a počet nejistých kontaktů. `uncertain`
   * je nepovinné: když se počet nepodaří zjistit, odkaz se ukáže bez čísla.
   * Vynechání celé vlastnosti odkaz skryje, což potřebují testy starších obrazovek.
   */
  vocativeReview?: { href: string; uncertain?: number | undefined };
  /**
   * Řeší projekt oslovení a 5. pád? Vypnuto skryje sloupec „Oslovení".
   *
   * Výchozí `true` je kvůli starším testům, které prop nepředávají; obrazovka
   * ho posílá vždycky.
   */
  greetingEnabled?: boolean;
};

/**
 * Výběr má dvě podoby a rozdíl mezi nimi je v 6.5 části 6 popsaný jako klasická past:
 * uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků, a smaže 50 000.
 *
 * ZNÁMÉ OMEZENÍ VŮČI P05. `DataTable` drží režim výběru („na stránce" versus „vše
 * odpovídající filtru") uvnitř `useRowSelection` a ven ho nepouští: `onSelectionChange`
 * se při rozšíření výběru na celý filtr vůbec nezavolá. Hromadné akce proto vždycky
 * dostanou režim `ids` s tím, co je opravdu zaškrtnuté. Aby rozhraní nelhalo, dialog
 * smazání počítá s týmž číslem. Až P05 přidá `onSelectionModeChange`, doplní se sem
 * druhá větev a nic dalšího se měnit nebude.
 */
export type Selection =
  { mode: 'ids'; ids: ReadonlySet<string>; count: number } | { mode: 'allMatching'; count: number };

export function ContactsTable({
  basePath,
  workspaceId,
  rows,
  pagination,
  total,
  filters,
  names,
  cursorInvalid = false,
  tags = [],
  lists = [],
  vocativeReview,
  greetingEnabled = true,
}: ContactsTableProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('selection.selectRow', { email: '' }).trim(),
    selectAllOnPage: t('selection.selectPage'),
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const describeChips = useFilterChips();
  const contactExport = useContactExport(workspaceId);

  if (rows.length === 0) {
    return hasAnyFilter(filters) ? (
      <ContactsFilteredEmptyState basePath={basePath} filters={filters} names={names} />
    ) : (
      <ContactsEmptyState basePath={basePath} workspaceId={workspaceId} />
    );
  }

  const selection: Selection = {
    mode: 'ids',
    ids: new Set(selectedIds),
    count: selectedIds.length,
  };

  const chips = describeChips(filters, names);

  return (
    <section className="flex flex-col gap-4">
      {/* Cesty, jak sem dostat kontakty, patří nad tabulku, ne jen do prázdného stavu.
          Prázdný stav vidí uživatel jednou; potřebu přidat jeden kontakt ručně má
          i potom, a do téhle chvíle na to na neprázdném seznamu nebylo tlačítko. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('list.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => router.push(`${basePath}/new`)}>
            {t('list.addContact')}
          </Button>
          <Button variant="secondary" onClick={() => router.push(`${basePath}/import`)}>
            {t('list.import')}
          </Button>
          {/* Vložení textem je třetí cesta, jak sem dostat kontakty, a bez tlačítka
              tady by se k ní uživatel dostal jedině napsáním adresy do prohlížeče. */}
          <Button variant="secondary" onClick={() => router.push(`${basePath}/paste`)}>
            {t('paste.entry')}
          </Button>
          {/* Export seznamu. Klíč `list.export` ležel v katalogu od začátku, tlačítko
              k němu nikdy nevzniklo, takže se kontakty ze seznamu vyvézt nedaly vůbec:
              jediná cesta k exportu vedla přes dialog mazání, a ten končil na 422.
              Exportuje se to, co je vidět, tedy aktuální filtr. */}
          <Button
            variant="secondary"
            onClick={() =>
              void contactExport.start({
                title: t('list.exportTitle'),
                fileName: t('list.exportFileName'),
                outcome: filtersToAudience(filters),
              })
            }
          >
            {t('list.export')}
          </Button>
          {/* Fronta „Kontrola oslovení" byla do téhle chvíle dostupná jedině z výsledku
              importu. Právě kvůli nejistým oslovením existuje, takže musí být dosažitelná
              odtud, kde je uživatel vidí ve sloupci. */}
          {vocativeReview !== undefined ? (
            <Button
              variant="secondary"
              data-testid="vocative-review-link"
              onClick={() => router.push(vocativeReview.href)}
            >
              {vocativeReview.uncertain === undefined
                ? t('greeting.reviewLink')
                : t('greeting.reviewLinkCount', { count: vocativeReview.uncertain })}
            </Button>
          ) : null}
        </div>
      </div>

      {/*
       * FILTR MUSÍ BÝT VIDĚT NAD SEZNAMEM, ne jen v prázdném stavu.
       *
       * `filterDescription` níž se v `DataTable` používá JEDINĚ uvnitř lišty výběru,
       * takže po prokliku ze štítku viděl uživatel jeden kontakt a nikde se nedozvěděl,
       * proč jich není víc ani jak se filtru zbaví. Filtr přitom žije v URL, takže ho
       * ani nešlo poznat z ovládacích prvků: žádné tu nejsou.
       */}
      {chips.length > 0 ? (
        <div
          data-testid="contacts-filter-summary"
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] bg-surface-muted px-4 py-3 text-sm text-text"
        >
          <span>{t('list.filteredFilter', { filter: format.list(chips) })}</span>
          <Button variant="link" onClick={() => router.push(basePath)}>
            {t('list.filteredClearAll')}
          </Button>
        </div>
      ) : null}

      <DataTable
        tableId="contacts"
        caption={t('list.title')}
        rows={rows}
        getRowId={(row) => row.id}
        labels={labels}
        count={{
          value: total?.count ?? rows.length,
          precision: total?.precision ?? 'exact',
        }}
        cursorInvalid={cursorInvalid}
        filterDescription={chips.length > 0 ? format.list(chips) : ''}
        selection={{ selectedIds, onSelectionChange: setSelectedIds }}
        // Hromadné akce jsou klientská komponenta, kterou skládá tabulka, ne stránka:
        // funkci `renderBulkActions` by ze serverové komponenty nešlo předat, protože
        // přes hranici React Server Components projdou jen serializovatelné hodnoty.
        bulkActions={
          <ContactsBulkActions
            workspaceId={workspaceId}
            selection={selection}
            filters={filters}
            names={names}
            tags={tags}
            lists={lists}
            // Adresy vybraných řádků. Publikum exportu umí vyjmenovat kontakty jen
            // e-mailem: `Audience` výčet id nezná a `CONTACT_FIELD_KEYS` v segmentech
            // `id` nemá. Tabulka je na obrazovce stejně ukazuje, takže je má po ruce.
            selectedEmails={rows
              .filter((row) => selection.mode === 'ids' && selection.ids.has(row.id))
              .map((row) => row.email)}
          />
        }
        onRowActivate={(row) => router.push(`${basePath}/${row.id}`)}
        virtualizeFrom={100}
        // Sedm místo výchozích šesti kvůli sloupci s potvrzením. Bez toho by se z výchozí
        // sady vytlačily štítky a nový sloupec by se prosadil na jejich úkor.
        defaultVisibleColumns={7}
        // Kurzorové stránkování bez čísel stránek. Kurzor jde do URL, ne do stavu
        // komponenty: odkaz na stránku se dá poslat dál a zpětné tlačítko funguje.
        pagination={{
          hasMore: pagination.has_more && pagination.next_cursor !== null,
          canGoBack: pagination.prev_cursor !== null,
          onPrevious: () => router.push(contactsHref(basePath, filters, pagination.prev_cursor)),
          onNext: () => router.push(contactsHref(basePath, filters, pagination.next_cursor)),
        }}
        // Typ je uvedený VÝSLOVNĚ. Bez něj TypeScript neodvodí `row` u žádného
        // sloupce, jakmile je v poli i `null` z podmíněného sloupce oslovení.
        columns={(
          [
            {
              id: 'email',
              header: t('columns.email'),
              cell: (row) => (
                <Link
                  href={`${basePath}/${row.id}`}
                  aria-label={t('list.openDetail', { email: row.email })}
                >
                  {row.email}
                </Link>
              ),
            },
            { id: 'name', header: t('columns.name'), cell: (row) => row.name ?? '' },
            // Oslovení hned za jménem: rozdíl mezi „Petr" a „Petře" je celý produkt
            // a v žádném jiném sloupci ho vidět není. Projekt, který oslovení neřeší,
            // sloupec nemá; `.filter(Boolean)` pod definicí ho vystřihne.
            greetingEnabled
              ? {
                  id: 'greeting',
                  header: t('greeting.column'),
                  cell: (row: ContactRow) => <GreetingBadge contact={row.greeting} />,
                }
              : null,
            {
              id: 'status',
              header: t('columns.status'),
              cell: (row) => (
                <ContactStatusBadges
                  badges={
                    describeContactState({
                      status: row.status,
                      processing_restricted: row.processing_restricted,
                      snooze_until: row.snooze_until,
                      anonymized_at: row.anonymized_at,
                      status_changed_at: row.created_at,
                    }).badges
                  }
                />
              ),
            },
            /*
             * Potvrzení PŘÍMO V ŘÁDKU, ne až na detailu a ne až po zaškrtnutí.
             *
             * Hromadná akce nad výběrem zůstává, protože je užitečná u dávky, ale pro jeden
             * kontakt znamenala tři kroky (zaškrtnout, najít tlačítko nad tabulkou, kliknout)
             * a stejně tak dlouhá byla odbočka na detail a zpátky. Tlačítko v řádku je jedno
             * kliknutí.
             *
             * SLOUPEC STOJÍ HNED ZA STAVEM SCHVÁLNĚ, ne na konci. `useColumnPreferences`
             * schová všechny sloupce za prvními šesti, dokud si uživatel nevybere jinak,
             * takže akce na konci by se novému uživateli nezobrazila vůbec. Zároveň se kvůli
             * ní zvedla výchozí sada na sedm sloupců, aby z ní nevypadl žádný, který v ní
             * byl dřív.
             *
             * Klik na tlačítko NEOTEVŘE detail: `DataTable.onRowClick` ignoruje cíle uvnitř
             * `button, a, input, label`, takže se aktivace řádku nespustí.
             */
            {
              id: 'confirm',
              header: t('confirmState.column'),
              cell: (row) => (
                <ConfirmContactButton
                  workspaceId={workspaceId}
                  contactId={row.id}
                  status={row.status}
                  email={row.email}
                  variant="row"
                />
              ),
            },
            { id: 'lists', header: t('columns.lists'), cell: (row) => format.list(row.lists) },
            { id: 'tags', header: t('columns.tags'), cell: (row) => format.list(row.tags) },
            {
              id: 'createdAt',
              header: t('columns.createdAt'),
              cell: (row) => (
                <time dateTime={row.created_at}>
                  {format.dateTime(new Date(row.created_at), 'short')}
                </time>
              ),
            },
          ] satisfies (DataTableColumn<ContactRow> | null)[]
        ).filter((column) => column !== null)}
      />

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />
    </section>
  );
}
