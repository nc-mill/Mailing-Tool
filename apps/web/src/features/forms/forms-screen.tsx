'use client';

import { Fragment, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
// Odkazy i router jdou přes `@mlain/i18n/navigation`, ne přímo z Nextu:
// obálka drží prefix jazyka v adrese.
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
import { Plus } from '@mlain/ui/icons';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, MoreIcon } from '@/lib/ui/status-icons';
import { BulkRemovalAction, runBulkRemoval } from '@/lib/ui/bulk-removal';
import { useContactsTableLabels } from '@/features/contacts/table-labels';
import { createFormAction, deleteFormAction, updateFormAction } from './actions';
import { CreateFormDialog } from './create-form-dialog';
import { FormDeleteDialog } from './form-delete-dialog';
import {
  DESTRUCTIVE_FORM_ACTIONS,
  formRowActions,
  formTargetListHref,
  type FormRowAction,
} from './form-state';
import type { FormView, ListOption } from './types';

/**
 * Nabídka „…" v řádku formuláře, tvarem shodná s kontakty.
 *
 * Do 6. 8. 2026 vedla z řádku jediná cesta, a to „Kód k vložení" ve vlastním
 * sloupci. Pozastavení formuláře bylo schované v přepínači uvnitř editoru,
 * takže se muselo dvakrát proklikat, a smazat formulář šlo taky jen odtamtud.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle: „Pozastavit" a „Spustit" jsou dvě
 * různé položky a v nabídce stojí vždycky ta, která stav doopravdy změní.
 * Rozhoduje `formRowActions` ve sdíleném `form-state.ts`.
 *
 * Okno mazání kreslí obrazovka, ne tahle komponenta: obsah rozbalené nabídky se
 * při volbě položky odpojí z DOM a odnesl by okno s sebou dřív, než by se
 * ukázalo.
 */
function FormRowMenu({
  form,
  canEdit,
  onAction,
}: {
  form: FormView;
  canEdit: boolean;
  onAction: (action: FormRowAction, form: FormView) => void;
}) {
  const tf = useTranslations('forms');
  const actions = formRowActions(form, { write: canEdit });

  if (actions.length === 0) return null;

  const firstDestructive = actions.findIndex((action) => DESTRUCTIVE_FORM_ACTIONS.includes(action));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={tf('table.rowMenu', { name: form.name })}
          data-testid={`form-row-menu-${form.id}`}
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
              {...(DESTRUCTIVE_FORM_ACTIONS.includes(action) ? ({ tone: 'danger' } as const) : {})}
              onSelect={() => onAction(action, form)}
            >
              {tf(`rowActions.${action}`)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
    // Pruh výběru nesmí nad formuláři mluvit o kontaktech.
    selectionWording: 'generic',
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /*
   * Formulář, nad kterým je otevřené okno mazání. Drží ho obrazovka, ne řádek:
   * obsah rozbalené nabídky se při volbě položky odpojí z DOM i s oknem.
   */
  const [deleting, setDeleting] = useState<FormView | null>(null);
  const [, startTransition] = useTransition();
  /*
   * Výběr řádků. `DataTable` kreslí zaškrtávátka VŽDYCKY a vypnout se nedají, takže
   * je tabulka formulářů měla od začátku, jenže výběr nikam nevedl: pruh nad ní uměl
   * jedině vybrat všechno a zase to zrušit.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** `clearToken` pro tabulku: režim „vybráno všech N" bydlí uvnitř ní. */
  const [clearedSelections, setClearedSelections] = useState(0);

  const listNames = new Map(lists.map((list) => [list.id, list.name]));
  /*
   * Kořen projektu, tedy `basePath` bez koncového `/forms`. Odkaz na cílový
   * seznam vede mimo sekci formulářů a stránka posílá jen cestu k té sekci.
   */
  const workspaceBase = basePath.replace(/\/forms$/, '');

  /**
   * Pozastavení a spuštění. Obojí je `PATCH /forms/{id}` s jediným polem
   * `active`, tedy táž akce, jakou volá přepínač v editoru; potvrzovací okno
   * nemá: přepnout zpátky jde jedním kliknutím v téže nabídce.
   *
   * VÝSLEDEK MUSÍ BÝT VIDĚT, proto `router.refresh()`: řádek se po změně liší
   * jen odznakem stavu a bez obnovy by zůstal viset na staré hodnotě.
   */
  function setActive(form: FormView, active: boolean) {
    setFailure(null);
    startTransition(async () => {
      const result = await updateFormAction({ workspaceId, id: form.id, body: { active } });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? tf('editor.failed') : result.detail);
        return;
      }
      router.refresh();
    });
  }

  function remove(form: FormView) {
    setFailure(null);
    startTransition(async () => {
      const result = await deleteFormAction({ workspaceId, id: form.id });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? tf('editor.failed') : result.detail);
        return;
      }
      setDeleting(null);
      router.refresh();
    });
  }

  /**
   * Hromadné smazání označených formulářů.
   *
   * SMAZAT JDE KAŽDÝ FORMULÁŘ, žádný stav to neomezuje (`formRowActions` nabízí
   * mazání vždycky, když má člověk právo zapisovat), takže se tu nic nepřeskakuje.
   * Volá se `deleteFormAction` po jednom, hromadný endpoint API nemá.
   *
   * NENÍ TO POZASTAVENÍ. Následky jsou tytéž jako u jednoho formuláře a jedna z vět
   * říká výslovně, že na dočasné zastavení je přepínač, ne mazání; při dvanácti
   * označených řádcích to platí tím spíš.
   */
  const selected = forms.filter((row) => selectedIds.includes(row.id));

  async function deleteSelected(): Promise<{ failed: number; detail: string | null }> {
    setFailure(null);
    const { failedIds, detail } = await runBulkRemoval(
      selected.map((row) => row.id),
      async (id) => {
        const result = await deleteFormAction({ workspaceId, id });
        return result.status === 'error'
          ? { status: 'error' as const, code: result.detail === '' ? result.code : result.detail }
          : { status: 'success' as const };
      },
    );
    router.refresh();
    if (failedIds.length === 0) {
      // Výběr se ruší JEN po úspěchu: po chybě by uživatel přišel o odklikanou práci.
      setSelectedIds([]);
      setClearedSelections((count) => count + 1);
      return { failed: 0, detail: null };
    }
    // Ve výběru zůstane jen to, co se smazat nepodařilo.
    setSelectedIds(failedIds);
    setClearedSelections((count) => count + 1);
    return { failed: failedIds.length, detail };
  }

  /** Volba z řádkové nabídky. Vratné akce běží rovnou, mazání otevře okno. */
  function onRowAction(action: FormRowAction, form: FormView) {
    switch (action) {
      case 'edit':
        router.push(`${basePath}/${form.id}`);
        return;
      case 'embed':
        router.push(`${basePath}/${form.id}/embed`);
        return;
      case 'pause':
        setActive(form, false);
        return;
      case 'activate':
        setActive(form, true);
        return;
      case 'viewList': {
        const listId = form.list_ids[0];
        if (listId !== undefined) router.push(formTargetListHref(workspaceBase, listId));
        return;
      }
      case 'delete':
        setDeleting(form);
        return;
    }
  }

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
        selection={{
          selectedIds: selected.map((row) => row.id),
          onSelectionChange: setSelectedIds,
          clearToken: clearedSelections,
        }}
        {...(canEdit
          ? {
              /*
               * Bez práva upravovat se pruh nechá bez akcí: mazání je jediná hromadná
               * akce, kterou formuláře mají, a server by ji stejně odmítl.
               */
              bulkActions: (
                <BulkRemovalAction
                  testId="forms-bulk"
                  removable={selected.length}
                  labels={{
                    action: tf('editor.bulkDelete', { count: selected.length }),
                    nothing: tf('editor.bulkDeleteNothing'),
                    title: tf('editor.bulkDeleteTitle', { count: selected.length }),
                    // TYTÉŽ VĚTY JAKO U JEDNOHO FORMULÁŘE. Následek se počtem nemění
                    // a druhý výčet by se s tím prvním dřív nebo později rozešel.
                    explanation: [
                      tf('editor.deleteConsequenceForm'),
                      tf('editor.deleteConsequenceSubmissions'),
                      tf('editor.deleteConsequenceAlternative'),
                    ],
                    submit: tf('editor.bulkDelete', { count: selected.length }),
                    submitting: tf('editor.bulkDeleteSubmitting'),
                    cancel: tc('cancel'),
                    failed: ({ failed, detail }) =>
                      tf('editor.bulkDeleteFailed', { count: failed, detail: detail ?? '' }),
                  }}
                  onConfirm={deleteSelected}
                />
              ),
            }
          : {})}
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
            cell: (row) => {
              /*
               * Zahozená odeslání se hlásí VEDLE počtu přihlášení, ne v něm.
               *
               * Ochrana zahazuje TIŠE, aby si robot neodvodil, které pravidlo ho
               * chytlo. Cena za to padá i na člověka: správce hesel vyplní pole
               * naráz, časová past (výchozí dvě sekundy) odeslání zahodí, návštěvník
               * uvidí „Poslali jsme vám e-mail" a žádný nedostane. Tenhle řádek je
               * jediné místo, kde na to jde přijít, a proto tu je: číslo bez něj
               * říkalo „čtyři přihlášení" a mlčelo o dalších třech ztracených.
               */
              const dropped = Object.values(row.dropped_30d ?? {}).reduce((a, b) => a + b, 0);
              return (
                <span className="flex flex-col">
                  <span className="text-ui text-text">
                    {t('forms.signups', { count: row.accepted_30d })}
                  </span>
                  {dropped > 0 ? (
                    <span className="font-mono text-meta text-text-muted">
                      {tf('table.dropped', { count: dropped })}
                    </span>
                  ) : null}
                </span>
              );
            },
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
            /*
             * Nabídka „…" na konci řádku. Nahradila samostatný odkaz „Kód
             * k vložení": ten byl jedinou akcí v řádku, takže se všechno ostatní
             * muselo hledat uvnitř formuláře. Vložení na web z nabídky nezmizelo,
             * jen se postavilo vedle úpravy, pozastavení a mazání.
             */
            id: 'actions',
            header: t('columns.action'),
            width: 60,
            cell: (row) => (
              <span className="flex justify-end">
                <FormRowMenu form={row} canEdit={canEdit} onAction={onRowAction} />
              </span>
            ),
          },
        ]}
      />

      {dialog}

      {deleting !== null && (
        <FormDeleteDialog
          // `key` zařídí, že okno otevřené nad jiným formulářem začíná načisto.
          key={deleting.id}
          form={deleting}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={() => remove(deleting)}
        />
      )}
    </>
  );
}
