'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
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
import { MoreIcon } from '@/lib/ui/status-icons';
import { ContactsBulkActions } from './bulk-actions';
import { ConfirmContactButton } from './confirm-contact-button';
import { ContactDeleteDialog } from './contact-delete-dialog';
import { ContactExportDialog, useContactExport } from './contact-export';
import { useUnsubscribeContact } from './contact-unsubscribe';
import { ContactsEmptyState, ContactsFilteredEmptyState } from './contacts-empty-state';
import { emailsToAudience, filtersToAudience } from './export-audience';
import { ProcessingRestrictionButton } from './processing-restriction-button';
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
  /**
   * Seznamy, ze kterých je kontakt JEŠTĚ PŘIHLÁŠENÝ, jen jejich identifikátory.
   *
   * Není to duplicita `lists` a není to navíc. `lists` nese jména do buňky tabulky,
   * tohle je podklad pro odhlášení v nabídce řádku: odhlášení je v API operace
   * NAD SEZNAMEM (`DELETE /lists/{id}/subscribe`), takže bez identifikátorů se
   * zavolat nedá, a bez stavu by se volalo i na seznamy, ze kterých je člověk
   * odhlášený dávno. Prázdné pole znamená, že se odhlásit není odkud, a nabídka
   * tu položku vůbec neukáže.
   */
  subscribed_list_ids: string[];
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
  /**
   * Smí přihlášený člověk sáhnout na omezení zpracování podle článku 18? Rozhoduje
   * `suppressions:write`, stejně jako na detailu kontaktu.
   *
   * V nabídce řádku se položka bez oprávnění NENABÍZÍ, kdežto na detailu je místo
   * tlačítka věta, koho požádat. Je to schválně: detail je jediná obrazovka, kde
   * se o omezení dá něco dozvědět, takže tam vysvětlení patří. V řádku seznamu by
   * padesát zašedlých položek pod sebou jen zabíralo místo a odpověď „koho požádat"
   * je od nich dvě kliknutí daleko.
   */
  canManageRestriction: boolean;
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

/**
 * Nabídka „…" v řádku: čtyři akce z detailu kontaktu, aby se kvůli nim nemuselo
 * rozklikávat.
 *
 * NIC SE TU NEDĚLÁ ZNOVU. Úprava je odkaz na formulář, odhlášení drží
 * `useUnsubscribeContact`, omezení zpracování `ProcessingRestrictionButton`
 * (včetně povinného odůvodnění a zápisu do auditu) a mazání `ContactDeleteDialog`
 * (včetně výčtu následků a nabídky stáhnout data předem). Nabídka jen říká, která
 * z nich má u tohohle kontaktu smysl, a otevře ji.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, stejně jako na Štítcích a stejně jako na detailu
 * kontaktu: odhlášení už odhlášeného, omezení už omezeného ani cokoli u smazaného
 * nebo anonymizovaného kontaktu v nabídce není. Zašedlá položka bez vysvětlení je
 * zakázaná (kritérium 18 části 6) a vysvětlení se do řádku tabulky nevejde.
 *
 * Okna kreslí tabulka, ne tahle komponenta: obsah rozbalené nabídky se při výběru
 * položky odpojí z DOM a odnesl by okno s sebou dřív, než by se stačilo ukázat.
 */
function ContactRowMenu({
  row,
  basePath,
  canManageRestriction,
  onUnsubscribe,
  onRestrict,
  onDelete,
}: {
  row: ContactRow;
  basePath: string;
  canManageRestriction: boolean;
  onUnsubscribe: (row: ContactRow) => void;
  onRestrict: (row: ContactRow) => void;
  onDelete: (row: ContactRow) => void;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();

  const state = describeContactState({
    status: row.status,
    processing_restricted: row.processing_restricted,
    snooze_until: row.snooze_until,
    anonymized_at: row.anonymized_at,
    status_changed_at: row.created_at,
  });

  const canEdit = state.actions.includes('edit');
  // Tatáž podmínka jako na detailu: kontakt musí být v nějakém seznamu ještě
  // přihlášený, jinak nemá odhlášení co zavolat a skončilo by chybou ze serveru.
  const canUnsubscribe =
    state.actions.includes('unsubscribe') && row.subscribed_list_ids.length > 0;
  const canRestrict = !state.restricted && !state.readOnly && canManageRestriction;
  const canDelete = state.actions.includes('delete');

  // Smazaný ani anonymizovaný kontakt nemá v nabídce nic, takže se nekreslí ani
  // spouštěč. Prázdná nabídka je horší než žádná: slibuje akce, které nemá.
  if (!canEdit && !canUnsubscribe && !canRestrict && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('list.rowMenu', { email: row.email })}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX.
           *
           * 34 px je `--size-control-xs`, tedy ikonová akce v řádku tabulky, a stojí
           * hned vedle stejně velkého potvrzení ve vedlejším sloupci. Tlačítko o straně
           * 44 px by řádek natáhlo z 62 na 72 px na nejčastěji otevírané obrazovce
           * produktu. Plocha se proto roztahuje neviditelným překryvem: ukazatel má
           * 44 × 44 px podle pravidla, řádek si drží rytmus návrhu.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
          /*
           * Klávesu tady NIC NEZASTAVUJE, a je to tak správně.
           *
           * Chvíli tu stálo `onKeyDown` se `stopPropagation`, protože obsluha kláves
           * na řádku `DataTable` brala Enter i mezerník i tehdy, když přišly
           * z tlačítka uvnitř buňky, takže Enter otevřel detail místo nabídky. To
           * bylo obcházení příčiny na jednom místě. Příčina je od 6. 8. 2026
           * opravená v `DataTable` (`ROW_CONTROLS`), takže tahle pojistka zmizela;
           * dvě ochrany nad sebou by jen zakrývaly, kde se to řeší doopravdy.
           */
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit ? (
          <DropdownMenuItem onSelect={() => router.push(`${basePath}/${row.id}/edit`)}>
            {t('detail.actionEdit')}
          </DropdownMenuItem>
        ) : null}
        {canUnsubscribe ? (
          <DropdownMenuItem onSelect={() => onUnsubscribe(row)}>
            {t('detail.actionUnsubscribe')}
          </DropdownMenuItem>
        ) : null}
        {canRestrict ? (
          <DropdownMenuItem onSelect={() => onRestrict(row)}>
            {t('restricted.restrictAction')}
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            {/* Oddělovač před červenou akcí, stejně jako na Štítcích: mazání nemá
                stát v jedné řadě s úpravou, ať se netrefí omylem. */}
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={() => onDelete(row)}>
              {t('detail.actionDelete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
  canManageRestriction,
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
  /*
   * Okna nabídky „…" drží obrazovka, ne řádek.
   *
   * Kontakt zůstává nastavený i po zavření okna a maže ho teprve volba jiného
   * řádku. Vynulovat ho při zavření nejde: mazání i omezení zavírají okno hned
   * a teprve pak čekají na odpověď serveru, takže by si komponenta odpojila
   * z DOM vlastní rozdělanou práci. `key` zařídí, že okno otevřené nad jiným
   * kontaktem začíná s prázdným odůvodněním.
   */
  const [restrictTarget, setRestrictTarget] = useState<ContactRow | null>(null);
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const describeChips = useFilterChips();
  const contactExport = useContactExport(workspaceId);
  const unsubscribe = useUnsubscribeContact(workspaceId);

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
   * Stažení dat jednoho kontaktu z okna mazání. Vede přes týž `useContactExport`
   * jako export seznamu, takže je na obrazovce jediný dialog průběhu. Kontakt se
   * do publika vyjmenuje adresou, protože id do podmínek publika nepatří.
   */
  function exportContact(row: ContactRow) {
    void contactExport.start({
      title: t('detail.actionExport'),
      fileName: row.email,
      outcome: emailsToAudience([row.email]),
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
        // Devět místo výchozích šesti: osm sloupců návrhu plus nabídka „…" na konci
        // řádku. Žádný z nich se nesmí schovat za nastavení sloupců, dokud si to
        // uživatel sám nepřeje, a u nabídky to platí dvojnásob: schovaná nabídka
        // znamená, že se z řádku nedá udělat vůbec nic.
        defaultVisibleColumns={9}
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
            /*
             * Nabídka „…" na konci řádku, tvarem shodná se Štítky a seznamem segmentů.
             *
             * Řádek zůstává prokliknutelný na detail: nabídka je zkratka pro čtyři akce,
             * které tam jsou, ne jejich náhrada. `DataTable` cíle uvnitř `button`
             * a `[role="menuitem"]` z aktivace řádku vyjímá, takže se detail neotevře
             * ani při otevírání nabídky, ani při volbě položky.
             */
            {
              id: 'actions',
              // `columns.action` je týž popisek, jaký nad sloupcem s nabídkou mají
              // Formuláře, Blokované adresy i Vlastní pole. Nový klíč by znamenal
              // dvě slova pro jednu věc, která se má napříč aplikací číst stejně.
              header: t('columns.action'),
              width: 60,
              cell: (row: ContactRow) => (
                <span className="flex justify-end">
                  <ContactRowMenu
                    row={row}
                    basePath={basePath}
                    canManageRestriction={canManageRestriction}
                    onUnsubscribe={(target) => {
                      void unsubscribe({
                        email: target.email,
                        listIds: target.subscribed_list_ids,
                      });
                    }}
                    onRestrict={(target) => {
                      setRestrictTarget(target);
                      setRestrictOpen(true);
                    }}
                    onDelete={(target) => {
                      setDeleteTarget(target);
                      setDeleteOpen(true);
                    }}
                  />
                </span>
              ),
            },
          ] satisfies (DataTableColumn<ContactRow> | null)[]
        ).filter((column) => column !== null)}
      />

      {/* Okno omezení zpracování podle článku 18. Je to TÁŽ komponenta jako na detailu,
          jen bez vlastního spouštěče, takže povinné odůvodnění ani zápis do auditu nejde
          z řádku obejít. */}
      {restrictTarget === null ? null : (
        <ProcessingRestrictionButton
          key={restrictTarget.id}
          workspaceId={workspaceId}
          contactId={restrictTarget.id}
          name={restrictTarget.name ?? restrictTarget.email}
          mode="restrict"
          appearance="dialog"
          open={restrictOpen}
          onOpenChange={setRestrictOpen}
        />
      )}

      {deleteTarget === null ? null : (
        <ContactDeleteDialog
          key={deleteTarget.id}
          workspaceId={workspaceId}
          contactId={deleteTarget.id}
          name={deleteTarget.name ?? deleteTarget.email}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onExport={() => exportContact(deleteTarget)}
          // Seznam se obnoví na místě. Přenačtení celé stránky by sebralo pozici
          // ve stránkování i rozbalené filtry a smazaný řádek zmizí i takhle.
          onDeleted={() => {
            setDeleteOpen(false);
            router.refresh();
          }}
        />
      )}

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />
    </section>
  );
}
