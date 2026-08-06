'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { IconButton } from '@mlain/ui/components/icon-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Tooltip } from '@mlain/ui/components/tooltip';
import {
  CircleCheckBig,
  ClipboardList,
  Download,
  Search,
  SlidersHorizontal,
  SpellCheck2,
  Upload,
  UserRoundPlus,
} from '@mlain/ui/icons';
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
  /**
   * Kolik kontaktů čeká na potvrzení. Druhá půlka meta řádku pod názvem obrazovky:
   * návrh tam má „58 kontaktů · 12 nepotvrzených", protože nepotvrzený kontakt je
   * jediné číslo, se kterým se na téhle obrazovce dá něco udělat. Když se počet
   * nepodaří zjistit, vynechá se, místo aby se napsala nula.
   */
  unconfirmed?: number;
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

/**
 * Ikonové tlačítko v hlavičce obrazovky: 40px čtverec s hranou, popisek v bublině.
 *
 * Ikona sama význam nenese, proto `label` do `aria-label` i do bubliny. Bublina
 * se ukáže i při zaostření klávesnicí, protože spouštěčem je skutečné `<button>`.
 */
function HeaderIconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      {/* `title=""` vypíná prohlížečovou bublinu, kterou si `IconButton` doplňuje
          jako záchrannou síť. Vedle bubliny návrhu by se ukázaly dvě přes sebe. */}
      <IconButton
        variant="solid"
        size="sm"
        label={label}
        title=""
        icon={children}
        onClick={onClick}
      />
    </Tooltip>
  );
}

/** Jedno tlačítko segmentového přepínače stavu. Aktivní je tmavý panel, jako v návrhu. */
function StatusFilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'min-h-[var(--size-control)] px-[var(--spacing-stack)]',
        'border-r border-border last:border-r-0',
        'font-mono text-meta',
        'transition-colors duration-[var(--duration-fast)]',
        active
          ? 'bg-panel text-panel-foreground'
          : 'bg-surface text-text-muted hover:bg-surface-muted hover:text-text',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function ContactsTable({
  basePath,
  workspaceId,
  rows,
  pagination,
  total,
  unconfirmed,
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
  /**
   * Panel nastavení sloupců si drží obrazovka, ne tabulka. Spouštěč totiž podle
   * návrhu patří do hlavičky obrazovky vedle hlavní akce, a tam `DataTable`
   * nedosáhne. S předaným `columnSettings` si vlastní tlačítko nekreslí.
   */
  const [columnsOpen, setColumnsOpen] = useState(false);
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

  function exportList() {
    void contactExport.start({
      title: t('list.exportTitle'),
      fileName: t('list.exportFileName'),
      outcome: filtersToAudience(filters),
    });
  }

  /**
   * Přepnutí filtru stavu. Filtr žije v URL, ne ve stavu komponenty (4.4 části 6),
   * takže se odkaz na filtrovaný seznam dá poslat dál a zpětné tlačítko funguje.
   * Kurzor se úmyslně zahazuje: stránka 3 předchozího filtru v novém neexistuje.
   */
  function setStatus(status: ContactStatus | undefined) {
    const next: ContactListFilters = { ...filters };
    if (status === undefined) delete next.status;
    else next.status = status;
    router.push(contactsHref(basePath, next));
  }

  function search(query: string) {
    const next: ContactListFilters = { ...filters };
    const trimmed = query.trim();
    if (trimmed === '') delete next.q;
    else next.q = trimmed;
    router.push(contactsHref(basePath, next));
  }

  /**
   * Řádek pod názvem obrazovky. Dvě samostatná tvrzení oddělená středovou tečkou,
   * ne jedna věta složená z fragmentů (pravidlo 12.2 části 6): každé z nich má
   * v katalogu vlastní klíč a dává smysl i samo o sobě.
   */
  const meta = (
    <>
      {total === null
        ? t('list.countTotal', { count: rows.length })
        : total.precision === 'estimated'
          ? t('list.countTotalEstimated', { count: format.number(total.count) })
          : t('list.countTotal', { count: total.count })}
      {unconfirmed === undefined
        ? null
        : ` · ${t('list.countUnconfirmed', { count: unconfirmed })}`}
    </>
  );

  return (
    <section>
      {/* Cesty, jak sem dostat kontakty, patří nad tabulku, ne jen do prázdného stavu.
          Prázdný stav vidí uživatel jednou; potřebu přidat jeden kontakt ručně má
          i potom, a do téhle chvíle na to na neprázdném seznamu nebylo tlačítko.

          V návrhu jsou tři z nich ikonové čtverce s bublinou, protože pět textových
          tlačítek vedle sebe zabere celý řádek a hlavní akce se v nich ztratí. */}
      <PageHeader
        title={t('list.title')}
        meta={meta}
        actions={
          <>
            <HeaderIconAction
              label={t('list.import')}
              onClick={() => router.push(`${basePath}/import`)}
            >
              <Upload aria-hidden className="icon-md" />
            </HeaderIconAction>
            {/* Vložení textem je třetí cesta, jak sem dostat kontakty, a bez tlačítka
                tady by se k ní uživatel dostal jedině napsáním adresy do prohlížeče. */}
            <HeaderIconAction
              label={t('paste.entry')}
              onClick={() => router.push(`${basePath}/paste`)}
            >
              <ClipboardList aria-hidden className="icon-md" />
            </HeaderIconAction>
            {/* Export seznamu. Klíč `list.export` ležel v katalogu od začátku, tlačítko
                k němu nikdy nevzniklo, takže se kontakty ze seznamu vyvézt nedaly vůbec:
                jediná cesta k exportu vedla přes dialog mazání, a ten končil na 422.
                Exportuje se to, co je vidět, tedy aktuální filtr. */}
            <HeaderIconAction label={t('list.export')} onClick={exportList}>
              <Download aria-hidden className="icon-md" />
            </HeaderIconAction>
            {/* Nastavení sloupců je ikonový čtverec v hlavičce, ne pruh nad tabulkou.
                Tichá varianta: je to služební akce, nemá soupeřit s „Přidat kontakt". */}
            <Tooltip content={t('list.columnSettings')}>
              <IconButton
                variant="quiet"
                label={t('list.columnSettings')}
                title=""
                icon={<SlidersHorizontal aria-hidden className="icon-md" />}
                aria-expanded={columnsOpen}
                onClick={() => setColumnsOpen((open) => !open)}
              />
            </Tooltip>
            {/* Fronta „Kontrola oslovení" byla do téhle chvíle dostupná jedině z výsledku
                importu. Právě kvůli nejistým oslovením existuje, takže musí být dosažitelná
                odtud, kde je uživatel vidí ve sloupci. */}
            {vocativeReview !== undefined ? (
              <Button
                variant="secondary"
                data-testid="vocative-review-link"
                className="px-4.5 text-ui"
                onClick={() => router.push(vocativeReview.href)}
              >
                <SpellCheck2 aria-hidden className="icon-md" />
                {t('greeting.reviewLink')}
                {vocativeReview.uncertain === undefined ? null : (
                  <span className="font-mono text-label text-text-muted">
                    {format.number(vocativeReview.uncertain)}
                  </span>
                )}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => router.push(`${basePath}/new`)}>
              <UserRoundPlus aria-hidden className="icon-md" />
              {t('list.addContact')}
            </Button>
          </>
        }
      />

      {/* Hledání a filtr stavu. Do téhle chvíle na obrazovce žádné ovládání filtru
          nebylo: filtr sice žil v URL a šlo se na něj odkázat, ale zapnout se dal
          jedině prokliknutím odjinud nebo ručním dopsáním parametru do adresy. */}
      <div className="mb-[var(--spacing-gutter)] flex flex-wrap items-center gap-[var(--spacing-stack)]">
        <form
          role="search"
          className="flex h-[var(--size-control)] min-w-[280px] flex-1 items-center gap-[var(--spacing-inline)] rounded-[var(--radius-control)] border border-border-strong bg-field px-3.5 sm:flex-none"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('q');
            search(typeof value === 'string' ? value : '');
          }}
        >
          <Search aria-hidden className="icon-sm text-text-muted" />
          <input
            type="search"
            name="q"
            // `key` přepíše obsah pole, když se filtr změní zvenčí (proklik ze štítku,
            // zpětné tlačítko). Bez něj by v poli zůstal starý výraz z minulé adresy.
            key={filters.q ?? ''}
            defaultValue={filters.q ?? ''}
            aria-label={t('list.search')}
            placeholder={t('list.searchPlaceholder')}
            className="h-full w-full min-w-0 border-0 bg-transparent text-ui text-text outline-none placeholder:text-text-muted"
          />
        </form>

        <div
          role="group"
          aria-label={t('filters.statusGroup')}
          className="flex overflow-hidden rounded-[var(--radius-control)] border border-border"
        >
          <StatusFilterButton
            label={t('filters.statusAll')}
            active={filters.status === undefined}
            onClick={() => setStatus(undefined)}
          />
          <StatusFilterButton
            label={t('filters.statusActive')}
            active={filters.status === 'active'}
            onClick={() => setStatus('active')}
          />
          <StatusFilterButton
            label={t('filters.statusUnconfirmed')}
            active={filters.status === 'unconfirmed'}
            onClick={() => setStatus('unconfirmed')}
          />
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
        <Card
          as="div"
          tone="muted"
          padding="sm"
          data-testid="contacts-filter-summary"
          className="mb-[var(--spacing-gutter)] flex-row flex-wrap items-center gap-[var(--spacing-inline)]"
        >
          <span className="text-ui text-text">
            {t('list.filteredFilter', { filter: format.list(chips) })}
          </span>
          <Button variant="link" onClick={() => router.push(basePath)}>
            {t('list.filteredClearAll')}
          </Button>
        </Card>
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
        columnSettings={{ open: columnsOpen, onOpenChange: setColumnsOpen }}
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
        // Osm místo výchozích šesti: tolik sloupců má tabulka v návrhu a žádný z nich
        // se nesmí schovat za nastavení sloupců, dokud si to uživatel sám nepřeje.
        defaultVisibleColumns={8}
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
                  // Podtržení kreslí sám odkaz, takže `no-underline` musí být na `<a>`;
                  // na potomkovi by nezabralo. Adresa je v návrhu obyčejný text barvy
                  // písma, který se podtrhne teprve při najetí.
                  className="block truncate text-ui text-text no-underline hover:underline"
                >
                  {row.email}
                </Link>
              ),
            },
            {
              id: 'name',
              header: t('columns.name'),
              cell: (row) => <span className="block truncate text-ui">{row.name ?? ''}</span>,
            },
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
              width: 130,
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
             * JE TO IKONA S BUBLINOU, NE TLAČÍTKO SE SLOVEM. Rozhodnutí návrhu: sloupec má
             * 60 px a deset textových tlačítek pod sebou by z něj udělalo druhý sloupec stavu.
             * U potvrzeného kontaktu zůstává táž ikona v zelené, aby sloupec neměl díry a bylo
             * v něm na první pohled poznat, co je hotové.
             *
             * SLOUPEC STOJÍ HNED ZA STAVEM SCHVÁLNĚ, ne na konci. `useColumnPreferences`
             * schová všechny sloupce za prvními osmi, dokud si uživatel nevybere jinak,
             * takže akce na konci by se novému uživateli nezobrazila vůbec.
             *
             * Klik na tlačítko NEOTEVŘE detail: `DataTable.onRowClick` ignoruje cíle uvnitř
             * `button, a, input, label`, takže se aktivace řádku nespustí.
             */
            {
              id: 'confirm',
              header: t('confirmState.column'),
              width: 60,
              cell: (row) =>
                row.status === 'active' ? (
                  <Tooltip content={t('confirmState.confirmed')}>
                    <span
                      // Zaostřitelné schválně: bublina u potvrzení musí jít vyvolat
                      // i z klávesnice, ne jen myší.
                      tabIndex={0}
                      role="img"
                      aria-label={t('confirmState.confirmed')}
                      className="inline-flex size-[var(--size-control-xs)] items-center justify-center rounded-[var(--radius-control)] text-success-text"
                    >
                      <CircleCheckBig aria-hidden className="icon-md" />
                    </span>
                  </Tooltip>
                ) : (
                  <ConfirmContactButton
                    workspaceId={workspaceId}
                    contactId={row.id}
                    status={row.status}
                    email={row.email}
                    variant="row"
                  />
                ),
            },
            {
              id: 'lists',
              header: t('columns.lists'),
              cell: (row) => (
                // Čárkový výčet, ne „Brno a Newsletter": spojka v buňce tabulky svádí
                // číst dva štítky jako jeden název. Krátký styl dá čárku i v češtině,
                // kde samotný typ „unit" spojku pořád nechává.
                <span className="block truncate text-sm text-text-muted">
                  {format.list(row.lists, { type: 'unit', style: 'short' })}
                </span>
              ),
            },
            {
              id: 'tags',
              header: t('columns.tags'),
              cell: (row) => (
                <span className="block truncate text-sm text-text-muted">
                  {format.list(row.tags, { type: 'unit', style: 'short' })}
                </span>
              ),
            },
            {
              id: 'createdAt',
              header: t('columns.createdAt'),
              width: 100,
              cell: (row) => (
                <time
                  dateTime={row.created_at}
                  className="whitespace-nowrap font-mono text-meta text-text-muted"
                >
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
