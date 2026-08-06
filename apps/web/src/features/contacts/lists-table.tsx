'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus } from '@mlain/ui/icons';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useContactsTableLabels } from './table-labels';

export type ListRow = {
  id: string;
  name: string;
  confirmed_count: number;
  pending_count: number;
  double_opt_in: boolean;
  archived: boolean;
};

export function ListsTable({ basePath, lists }: { basePath: string; lists: ListRow[] }) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('lists.name'),
    selectAllOnPage: t('lists.title'),
  });

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
        ]}
      />
    </>
  );
}
