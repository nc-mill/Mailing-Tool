'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
// Odkazy i router jdou přes `@mlain/i18n/navigation`, ne přímo z Nextu:
// obálka drží prefix jazyka v adrese.
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { CodeXml, Plus } from '@mlain/ui/icons';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon } from '@/lib/ui/status-icons';
import { useContactsTableLabels } from '@/features/contacts/table-labels';
import { createFormAction } from './actions';
import { CreateFormDialog } from './create-form-dialog';
import type { FormView, ListOption } from './types';

/**
 * Seznam formulářů projektu.
 *
 * VZHLED JE ODVOZENÝ ZE SEZNAMŮ (`Mlain Mailer - Seznamy.dc.html`), protože
 * formuláře návrh nemají a rytmus obrazovky je stejný: hlavička s názvem,
 * úvodní věta místo mono meta řádku, jedno žluté tlačítko vpravo a pod tím
 * tabulka v kartě. Sloupce kopírují Seznamy i uvnitř řádku: název je 16 px
 * polotučně, druhořadý údaj tišší, stav je odznak ve vlastním sloupci.
 *
 * Popisky tabulky si bere z `features/contacts/table-labels`, ne z vlastní kopie:
 * je to přechodka mezi katalogem a tvarem `DataTable` a druhá by se s ní časem
 * rozešla. Formuláře čtou tentýž katalog (`contacts.forms.*`), takže to není
 * půjčka přes hranici domény.
 */
export function FormsScreen({
  forms,
  lists,
  workspaceId,
  basePath,
  canEdit,
}: {
  forms: FormView[];
  lists: ListOption[];
  workspaceId: string;
  /** Cesta k sekci bez slugu projektu, například `/w/muj-projekt/forms`. */
  basePath: string;
  canEdit: boolean;
}) {
  const t = useTranslations('contacts');
  const tf = useTranslations('forms');
  const tc = useTranslations('common.actions');
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('forms.name'),
    selectAllOnPage: t('forms.title'),
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const listNames = new Map(lists.map((list) => [list.id, list.name]));

  async function create(body: { name: string; list_ids: string[] }) {
    setFailure(null);
    const result = await createFormAction({ workspaceId, body });
    if (result.status === 'success') {
      // Po založení se rovnou otevře detail. Vrátit se do seznamu je slepá ulička:
      // uživatel zakládal formulář proto, aby ho nastavil a vložil na web.
      router.push(`${basePath}/${result.id}`);
      return result;
    }
    // Chyba na konkrétním poli patří k tomu poli a vypisuje si ji dialog sám.
    // Sem se dostane jen to, co k žádnému poli nepatří.
    if (Object.keys(result.fieldErrors).length === 0) {
      setFailure(result.detail === '' ? tf('create.failed') : result.detail);
    }
    return result;
  }

  const dialog = (
    <CreateFormDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      lists={lists}
      onSubmit={create}
    />
  );

  const header = (
    <PageHeader
      title={t('forms.title')}
      // Úvodní věta pod nadpisem je SANS 17 px, ne mono meta řádek: neříká počet,
      // ale co formulář vůbec je. Stejně jako u Seznamů, se kterými tahle
      // obrazovka stojí vedle sebe.
      description={t('forms.lead')}
      actions={
        canEdit ? (
          <Button variant="primary" data-testid="create-form" onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden className="icon-md" />
            {t('forms.create')}
          </Button>
        ) : null
      }
    />
  );

  if (forms.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          variant="first"
          title={t('forms.emptyTitle')}
          explanation={t('forms.emptyBody')}
          actions={
            canEdit
              ? [{ label: t('forms.emptyAction'), onClick: () => setDialogOpen(true) }]
              : // Bez práva zapisovat nemá prázdný stav co nabídnout, ale bez akce
                // ho `EmptyState` odmítne vykreslit (kritérium 20). Obnovení je
                // poctivá akce: seznam mohl mezitím naplnit kolega.
                [{ label: tc('refresh'), onClick: () => router.refresh() }]
          }
        />
        {dialog}
      </>
    );
  }

  return (
    <>
      {header}

      {failure !== null && (
        <Alert tone="error" className="mb-[var(--spacing-gutter)]" data-testid="forms-error">
          {failure}
        </Alert>
      )}

      <DataTable
        tableId="forms"
        caption={t('forms.title')}
        rows={forms}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: forms.length, precision: 'exact' }}
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
            header: t('forms.name'),
            cell: (row) => (
              // Název řádku je v návrhu 16 px polotučně a podtrhne se až při najetí.
              // Globální styl podtrhává každé `<a>`, takže `no-underline` musí být
              // na samotném odkazu, ne na potomkovi.
              <Link
                href={`${basePath}/${row.id}`}
                aria-label={tf('table.openDetail', { name: row.name })}
                className="text-base font-semibold text-text no-underline hover:underline"
              >
                {row.name}
              </Link>
            ),
          },
          {
            id: 'list',
            header: t('forms.targetList'),
            // Seznam, do kterého formulář zapisuje, je jeho hlavní vlastnost:
            // podle něj se pozná, kam přihlášení z webu doopravdy tečou.
            cell: (row) =>
              row.list_ids.length === 0 ? (
                <span className="text-ui text-text-muted">{tf('create.listNone')}</span>
              ) : (
                <span className="text-ui text-text">
                  {row.list_ids.map((id) => listNames.get(id) ?? id).join(', ')}
                </span>
              ),
          },
          {
            id: 'signups',
            // Vlastní hlavička, ne `contacts.columns.contact`: v sloupci je počet
            // přihlášení za 30 dní, ne kontakt, a hlavička „Kontakt" nad větou
            // „Žádné přihlášení za 30 dní" mate.
            header: tf('table.signups'),
            // Věta s číslem je v návrhu SANS 15 px, mono nese až druhořadý údaj
            // pod ní. Tady žádný druhý řádek není, takže zůstává samotná věta.
            cell: (row) => (
              <span className="text-ui text-text">
                {t('forms.signups', { count: row.accepted_30d })}
              </span>
            ),
          },
          {
            id: 'state',
            header: t('forms.state'),
            cell: (row) => (
              // Stav se nikdy nesděluje jen barvou, proto povinná ikona vedle slova.
              <Badge
                tone={row.active ? 'success' : 'neutral'}
                icon={row.active ? CheckIcon : ClockIcon}
              >
                {row.active ? t('forms.stateActive') : t('forms.statePaused')}
              </Badge>
            ),
          },
          {
            id: 'embed',
            header: t('columns.action'),
            cell: (row) => (
              <Link
                href={`${basePath}/${row.id}/embed`}
                className="inline-flex items-center gap-[var(--spacing-inline)] text-ui"
              >
                <CodeXml aria-hidden className="icon-sm shrink-0" />
                {tf('table.embed')}
              </Link>
            ),
          },
        ]}
      />

      {dialog}
    </>
  );
}
