'use client';

import { Fragment, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus } from '@mlain/ui/icons';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { MoreIcon } from '@/lib/ui/status-icons';
import { setDefaultListAction } from './list-email-actions';
import { ListArchiveDialog } from './list-archive-dialog';
import { ListConfirmPendingDialog } from './list-confirm-pending-dialog';
import {
  DESTRUCTIVE_LIST_ACTIONS,
  listContactsHref,
  listRowActions,
  type ListRowAction,
} from './list-state';
import { useContactsTableLabels } from './table-labels';

export type ListRow = {
  id: string;
  name: string;
  confirmed_count: number;
  pending_count: number;
  double_opt_in: boolean;
  archived: boolean;
  /**
   * Výchozí seznam projektu. Rozhoduje o položce „Nastavit jako výchozí": tomu,
   * který výchozí je, se nenabízí. `GET /lists` ho nese jako `is_default`,
   * dotahovat se nic nemusí.
   */
  is_default: boolean;
};

/** Práva přihlášeného člověka. Počítá je stránka, tabulka je jen předává dál. */
export type ListPermissions = { write: boolean; readContacts: boolean };

/**
 * Nabídka „…" v řádku seznamu, tvarem shodná s kontakty.
 *
 * Do 6. 8. 2026 z řádku nevedlo nic než otevření detailu. Nastavení výchozího
 * seznamu, potvrzení čekajících přihlášení i archivace byly schované uvnitř
 * detailu, takže se každá z nich musela proklikat přes dvě obrazovky.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Rozhoduje `listRowActions` ve
 * sdíleném `list-state.ts`.
 *
 * Okna kreslí obrazovka, ne tahle komponenta: obsah rozbalené nabídky se při
 * volbě položky odpojí z DOM a odnesl by okno s sebou dřív, než by se ukázalo.
 */
function ListRowMenu({
  row,
  permissions,
  onAction,
}: {
  row: ListRow;
  permissions: ListPermissions;
  onAction: (action: ListRowAction, row: ListRow) => void;
}) {
  const t = useTranslations('contacts');
  const actions = listRowActions(row, permissions);

  if (actions.length === 0) return null;

  const firstDestructive = actions.findIndex((action) => DESTRUCTIVE_LIST_ACTIONS.includes(action));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('lists.rowMenu', { name: row.name })}
          data-testid={`list-row-menu-${row.id}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů.
           * Tlačítko o straně 44 px by řádek natáhlo a rozešlo by se s rytmem
           * ostatních tabulek; plochu proto roztahuje neviditelný překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action}>
            {index === firstDestructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              {...(DESTRUCTIVE_LIST_ACTIONS.includes(action) ? ({ tone: 'danger' } as const) : {})}
              onSelect={() => onAction(action, row)}
            >
              {t(`lists.rowActions.${action}`)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListsTable({
  basePath,
  workspaceSlug,
  workspaceId,
  lists,
  permissions,
}: {
  basePath: string;
  /** Slug projektu. Odkaz na kontakty vede mimo sekci seznamů. */
  workspaceSlug: string;
  /** Projekt pro akce. Bez něj běží požadavek mimo kontext a RLS vrátí 404. */
  workspaceId: string;
  lists: ListRow[];
  permissions: ListPermissions;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('lists.name'),
    selectAllOnPage: t('lists.title'),
  });
  /*
   * Okna drží tabulka, ne řádek: obsah rozbalené nabídky se při volbě položky
   * odpojí z DOM i s oknem, které by v něm bydlelo.
   */
  const [archiving, setArchiving] = useState<ListRow | null>(null);
  const [confirming, setConfirming] = useState<ListRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Nastavení výchozího seznamu. Potvrzovat se nemá co: přepnout jde kdykoli
   * a na nikoho to nic neodešle.
   *
   * VÝSLEDEK MUSÍ BÝT VIDĚT. Řádek se po změně sám o sobě nijak neliší, takže
   * bez hlášky by kliknutí vypadalo jako by nic neudělalo.
   */
  function makeDefault(row: ListRow) {
    setFailure(null);
    setNotice(null);
    startTransition(async () => {
      const result = await setDefaultListAction({ workspaceId, listId: row.id });
      if (result.status !== 'success') {
        setFailure(t('lists.defaultFailed', { code: result.code }));
        return;
      }
      setNotice(t('lists.defaultChanged', { name: row.name }));
      router.refresh();
    });
  }

  /** Volba z řádkové nabídky. Vratné akce běží rovnou, zbytek otevře okno. */
  function onRowAction(action: ListRowAction, row: ListRow) {
    switch (action) {
      case 'viewContacts':
        router.push(listContactsHref(workspaceSlug, row.id));
        return;
      case 'edit':
        router.push(`${basePath}/${row.id}`);
        return;
      case 'setDefault':
        makeDefault(row);
        return;
      case 'confirmPending':
        setConfirming(row);
        return;
      case 'archive':
        setArchiving(row);
        return;
    }
  }

  const header = (
    <PageHeader
      title={t('lists.title')}
      // Pod nadpisem stojí VĚTA, ne mono meta řádek: neříká počet, ale co seznam
      // vůbec je. `description` na to má sans 17 px a strop šířky.
      description={t('lists.lead')}
      actions={
        <Button variant="primary" onClick={() => router.push(`${basePath}/new`)}>
          <Plus aria-hidden className="icon-md" />
          {t('lists.create')}
        </Button>
      }
    />
  );

  if (lists.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          variant="first"
          title={t('lists.emptyTitle')}
          explanation={t('lists.emptyBody')}
          // Prázdný stav nabízel „Načíst znovu", což nic nezakládá. Prvním krokem
          // v projektu bez seznamu je seznam založit.
          actions={[{ label: t('lists.create'), onClick: () => router.push(`${basePath}/new`) }]}
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Výsledek akce z nabídky. Řádek se po přepnutí výchozího seznamu ani po
          potvrzení čekajících viditelně nemění, takže bez hlášky by kliknutí
          vypadalo jako by nic neudělalo. */}
      {notice !== null && (
        <Alert
          tone="success"
          role="status"
          className="mb-[var(--spacing-gutter)]"
          data-testid="lists-notice"
        >
          {notice}
        </Alert>
      )}
      {failure !== null && (
        <Alert tone="error" className="mb-[var(--spacing-gutter)]" data-testid="lists-error">
          {failure}
        </Alert>
      )}

      <DataTable
        tableId="lists"
        caption={t('lists.title')}
        rows={lists}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: lists.length, precision: 'exact' }}
        onRowActivate={(row) => router.push(`${basePath}/${row.id}`)}
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          {
            id: 'name',
            header: t('lists.name'),
            cell: (row) => (
              <span className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                {/* Název je v návrhu 16 px polotučně a v barvě textu, ne odkazovou
                    žlutou. Podtržení kreslí globální styl na `<a>`, takže `no-underline`
                    musí být na samotném odkazu, ne na potomkovi. */}
                <Link
                  href={`${basePath}/${row.id}`}
                  aria-label={t('lists.openDetail', { name: row.name })}
                  className="text-base font-semibold text-text no-underline hover:underline"
                >
                  {row.name}
                </Link>
                {/* Bez ikony. Rozlišovacím znakem odznaku je slovo a návrh
                    u odznaků ikonu nemá, viz `DESIGN-ZAKLAD.md` 2.2. */}
                {row.archived ? <Badge tone="neutral">{t('lists.archived')}</Badge> : null}
              </span>
            ),
          },
          {
            id: 'members',
            header: t('lists.membersColumn'),
            // Dvě čísla pod sebou, obě celou větou. Potvrzení i čekající nesou
            // rozhodnutí: podle prvního se posílá, podle druhého se pozná zaseknutý
            // potvrzovací e-mail. Čekající jsou meta údaj, tedy mono.
            cell: (row) => (
              <span className="flex flex-col gap-0.5">
                <span className="text-ui text-text">
                  {t('lists.members', { count: row.confirmed_count })}
                </span>
                <span className="font-mono text-label text-text-muted">
                  {t('lists.pending', { count: row.pending_count })}
                </span>
              </span>
            ),
          },
          {
            id: 'doubleOptIn',
            // Hlavička sloupce je kratší než nadpis téhož nastavení na detailu:
            // ve 180 px se „Potvrzení přihlášení e-mailem" láme na dva řádky.
            header: t('lists.doubleOptInColumn'),
            width: 180,
            cell: (row) => (
              <Badge tone={row.double_opt_in ? 'success' : 'neutral'}>
                {row.double_opt_in ? t('lists.doubleOptInOn') : t('lists.doubleOptInOff')}
              </Badge>
            ),
          },
          {
            id: 'actions',
            header: t('columns.action'),
            width: 60,
            cell: (row) => (
              <span className="flex justify-end">
                <ListRowMenu row={row} permissions={permissions} onAction={onRowAction} />
              </span>
            ),
          },
        ]}
      />

      {/* Archivace používá TOTÉŽ okno jako detail seznamu, včetně výčtu následků
          i věty navíc u výchozího seznamu. Druhý výčet by se s tím prvním rozešel. */}
      {archiving !== null && (
        <ListArchiveDialog
          key={archiving.id}
          workspaceId={workspaceId}
          listId={archiving.id}
          name={archiving.name}
          isDefault={archiving.is_default}
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          onArchived={() => {
            setArchiving(null);
            setNotice(t('lists.archiveDone', { name: archiving.name }));
            router.refresh();
          }}
        />
      )}

      {confirming !== null && (
        <ListConfirmPendingDialog
          key={confirming.id}
          workspaceId={workspaceId}
          list={confirming}
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          onConfirmed={(result) => {
            setConfirming(null);
            setNotice(
              result.skipped > 0
                ? t('lists.confirmPendingDoneWithSkipped', {
                    confirmed: result.confirmed,
                    skipped: result.skipped,
                  })
                : t('lists.confirmPendingDone', { count: result.confirmed }),
            );
            router.refresh();
          }}
          onFailed={(code) => {
            setConfirming(null);
            setFailure(t('lists.confirmPendingFailed', { code }));
          }}
        />
      )}
    </>
  );
}
