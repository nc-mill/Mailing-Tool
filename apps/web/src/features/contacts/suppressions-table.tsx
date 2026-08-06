'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus } from '@mlain/ui/icons';
// K1 z 13.1 části 6: kurzorové stránkování bez čísel stránek, výběr přežije přestránkování.
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert, EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { addSuppressionAction, removeSuppressionAction } from './actions';
import { useContactsTableLabels } from './table-labels';
import {
  bulkRemovalSummary,
  suppressionAffordance,
  type SuppressionRow,
  type WorkspaceRole,
} from './suppression-affordance';

export type SuppressionsTableProps = {
  basePath: string;
  /** Projekt pro odebrání adresy. Bez něj server vrátí 404 na existující řádek. */
  workspaceId: string;
  rows: SuppressionRow[];
  role: WorkspaceRole;
  now?: Date;
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  filters: { reason?: string; q?: string };
};

/**
 * Tón odznaku podle důvodu blokace.
 *
 * Nejde o ozdobu: „nahlásil spam" a „ruční přidání" jsou pro odesílatele dvě
 * úplně jiné zprávy. Červená patří tomu, co se nesmí obejít (stížnost, výmaz
 * podle GDPR), žlutá tomu, co říká něco o adrese samé (nedoručuje se, je
 * neplatná), a klidný tón zbytku. Slovo v odznaku nese význam samo, barva ho
 * jen odstupňuje.
 */
const REASON_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = {
  complaint: 'danger',
  gdpr_erasure: 'danger',
  hard_bounce: 'warning',
  soft_bounce_threshold: 'warning',
  invalid: 'warning',
  ses_suppressed: 'warning',
};

function href(basePath: string, filters: { reason?: string; q?: string }, cursor: string | null) {
  const params = new URLSearchParams();
  if (filters.reason) params.set('reason', filters.reason);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

export function SuppressionsTable({
  basePath,
  workspaceId,
  rows,
  role,
  now,
  pagination,
  filters,
}: SuppressionsTableProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();
  const labels = useContactsTableLabels({
    selectRow: t('suppressions.selectRow', { email: '' }).trim(),
    selectAllOnPage: t('suppressions.selectPage'),
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /**
   * Otevřené odebrání: buď jeden řádek, nebo hromadný výběr. Obojí jde přes stejný
   * dialog, protože obojí volá týž `DELETE /suppressions/{id}` a ten u obou vyžaduje
   * poznámku. Hromadné odebrání ji dřív neposílalo vůbec a končilo na 422.
   */
  const [removing, setRemoving] = useState<
    { kind: 'single'; row: SuppressionRow } | { kind: 'bulk' } | null
  >(null);
  /** Poznámka do auditu. Prázdnou schéma odmítne, proto ji dialog vyžaduje. */
  const [removeNote, setRemoveNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addDetail, setAddDetail] = useState('');
  const [addPending, setAddPending] = useState(false);
  const [addFailed, setAddFailed] = useState(false);

  async function submitAdd() {
    setAddPending(true);
    setAddFailed(false);
    const result = await addSuppressionAction({
      workspaceId,
      email: addEmail,
      ...(addDetail === '' ? {} : { detail: addDetail }),
    });
    setAddPending(false);
    if (result.status !== 'success') {
      setAddFailed(true);
      return;
    }
    toast.success(t('suppressions.added', { email: addEmail }));
    setAdding(false);
    setAddEmail('');
    setAddDetail('');
    router.refresh();
  }

  /**
   * Dialog ručního zablokování. Prázdný stav i tabulka na něj sahají stejně,
   * protože adresu člověk přidává v obou stavech stejně často.
   */
  const addDialog = (
    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogTitle>{t('suppressions.addTitle')}</DialogTitle>
      <DialogBody>
        <p className="text-ui text-text-muted">{t('suppressions.addBody')}</p>
        {/* `Field` místo ručně spárovaného `Label` a `Input`: dodá vazbu popisku,
            `aria-describedby` k nápovědě i jednotné odsazení. */}
        <Field label={t('suppressions.addEmail')}>
          <Input
            type="email"
            value={addEmail}
            onChange={(event) => setAddEmail(event.target.value)}
          />
        </Field>
        <Field label={t('suppressions.addDetail')} hint={t('suppressions.addDetailHint')}>
          <Input value={addDetail} onChange={(event) => setAddDetail(event.target.value)} />
        </Field>
        {addFailed ? <Alert tone="error" title={t('suppressions.addFailed')} /> : null}
      </DialogBody>
      <DialogFooter
        retreat={<Button onClick={() => setAdding(false)}>{t('suppressions.addCancel')}</Button>}
        confirm={
          <Button variant="primary" pending={addPending} onClick={() => void submitAdd()}>
            {t('suppressions.addConfirm')}
          </Button>
        }
      />
    </Dialog>
  );

  const summary = bulkRemovalSummary(rows, new Set(selectedIds), role, now);

  function openRemoval(target: { kind: 'single'; row: SuppressionRow } | { kind: 'bulk' }) {
    setRemoveNote('');
    setRemoving(target);
  }

  /**
   * Odebrání jednoho řádku i celého výběru. Poznámka jde do těla požadavku, protože
   * `removal_note` je to jediné, z čeho se později pozná, PROČ někdo blokaci sundal.
   */
  async function submitRemoval() {
    if (removing === null) return;
    const ids = removing.kind === 'single' ? [removing.row.id] : summary.removableIds;
    let removed = 0;
    for (const id of ids) {
      const result = await removeSuppressionAction({ workspaceId, id, note: removeNote });
      if (result.status === 'success') removed += 1;
    }
    if (removed < ids.length) {
      toast.error(t('suppressions.removeFailed'));
      return;
    }
    if (removing.kind === 'single') {
      toast.success(t('suppressions.removed', { email: removing.row.masked_email }));
    } else {
      toast.success(t('suppressions.bulkRemoved', { count: removed }));
      setSelectedIds([]);
    }
    setRemoving(null);
    setRemoveNote('');
    router.refresh();
  }

  function renderAffordance(row: SuppressionRow) {
    const affordance = suppressionAffordance(row, role, now);
    if (affordance.kind === 'removable') return null;
    // Zámek s vysvětlením místo zašedlého tlačítka. Text je vidět i bez myši:
    // je v dokumentu, nikoliv jen v bublině.
    return (
      <span className="block text-meta text-text-muted">
        {affordance.explanationKey ? t(affordance.explanationKey, affordance.values) : null}
      </span>
    );
  }

  function renderAction(row: SuppressionRow) {
    const affordance = suppressionAffordance(row, role, now);
    if (affordance.kind === 'removable') {
      return (
        <Button variant="secondary" size="sm" onClick={() => openRemoval({ kind: 'single', row })}>
          {t('suppressions.remove')}
        </Button>
      );
    }
    // Čekání i zámek jsou stav, ne akce, takže mono: čte se to po znacích
    // („za 18 dní") a stojí to ve sloupci, kde jinde bývá tlačítko.
    if (affordance.kind === 'waiting') {
      return (
        <span className="font-mono text-meta text-text-muted">
          {t('suppressions.bounceWait', affordance.values)}
        </span>
      );
    }
    return <span className="font-mono text-meta text-text-muted">{t('suppressions.locked')}</span>;
  }

  if (rows.length === 0) {
    return (
      <>
        {/* Hlavička zůstává i v prázdném stavu, aby obrazovka měla název a člověk
            poznal, kde je. Akci „Přidat adresu" tu ale nese POUZE prázdný stav:
            dvě stejně pojmenovaná tlačítka vedle sebe by byla matoucí a rozdvojila
            by i hledání podle popisku. */}
        <PageHeader title={t('suppressions.title')} description={t('suppressions.lead')} />
        {filters.reason || filters.q ? (
          <FilteredEmptyState
            title={t('suppressions.filteredTitle')}
            explanation={t('suppressions.filteredBody')}
            filterDescription={filters.reason ?? filters.q ?? ''}
            clearFiltersLabel={t('suppressions.filteredClear')}
            onClearFilters={() => router.push(basePath)}
          />
        ) : (
          <>
            {/* Akce dřív volala `router.push(basePath)`, tedy navigaci na tutéž
                stránku: kliknutí nedělalo nic, ani chybu v konzoli. Text pod
                nadpisem přitom slibuje „Přidat si sem adresu můžete i ručně."
                a endpoint `POST /api/v1/suppressions` existoval celou dobu. */}
            <EmptyState
              variant="first"
              title={t('suppressions.emptyTitle')}
              explanation={t('suppressions.emptyBody')}
              actions={[{ label: t('suppressions.emptyAction'), onClick: () => setAdding(true) }]}
            />
            {addDialog}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('suppressions.title')}
        description={t('suppressions.lead')}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="icon-md" />
            {t('suppressions.emptyAction')}
          </Button>
        }
      />
      {addDialog}

      <DataTable
        tableId="suppressions"
        caption={t('suppressions.title')}
        rows={rows}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: rows.length, precision: 'exact' }}
        selection={{ selectedIds, onSelectionChange: setSelectedIds }}
        virtualizeFrom={100}
        // Vybrat jde každý řádek, i ten neodebratelný. Dvě věty z 8.10.1 části 6 si jen
        // zdánlivě odporují: „hromadný výběr se u ostatních důvodů nenabízí" znamená,
        // že se u nich nenabízí hromadné ODEBRÁNÍ, ne že by je nešlo zaškrtnout.
        // Vybrat vše na stránce musí fungovat, jinak by uživatel nikdy neviděl větu
        // „28 adres odebrat nejde", která ho o matici informuje.
        bulkActions={
          <span
            data-testid="suppressions-bulk"
            className="flex flex-wrap items-center gap-[var(--spacing-inline)]"
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                // Hromadné odebrání jde jen u toho, co matice dovoluje. Zbytek se nezahrne
                // a uživatel to ví dopředu z věty pod tlačítkem, ne z chyby po kliknutí.
                // Nic se neděje hned: i hromadné odebrání potřebuje poznámku do auditu.
                if (summary.removable === 0) return;
                openRemoval({ kind: 'bulk' });
              }}
            >
              {t('suppressions.bulkRemove', {
                removable: summary.removable,
                total: summary.total,
              })}
            </Button>
            {summary.blocked > 0 ? (
              // Pruh výběru je tmavý panel, takže text na něm musí být z panelové
              // řady barev, ne z papírové.
              <span className="text-panel-soft">
                {t('suppressions.bulkRemoveNote', { blocked: summary.blocked })}
              </span>
            ) : null}
          </span>
        }
        pagination={{
          hasMore: pagination.has_more && pagination.next_cursor !== null,
          canGoBack: pagination.prev_cursor !== null,
          onPrevious: () => router.push(href(basePath, filters, pagination.prev_cursor)),
          onNext: () => router.push(href(basePath, filters, pagination.next_cursor)),
        }}
        columns={[
          {
            id: 'email',
            header: t('columns.email'),
            cell: (row) => (
              // Adresa zůstává maskovaná. Tlačítko „Zobrazit celou adresu" tu bylo,
              // ale volalo `POST /suppressions/{id}/reveal`, což je cesta, jaká v API
              // nikdy nebyla: končilo to na 404 a adresa se neodkryla. Odpověď výpisu
              // nese jen `masked_email`, takže odkrýt není z čeho.
              <span
                data-testid={`suppression-${row.id}`}
                className="flex flex-col gap-[var(--spacing-hairline)]"
              >
                {/* E-mailová adresa se čte po znacích, takže mono. */}
                <span className="font-mono text-ui text-text">{row.masked_email}</span>
                {renderAffordance(row)}
              </span>
            ),
          },
          {
            id: 'reason',
            header: t('columns.reason'),
            cell: (row) => (
              <Badge tone={REASON_TONE[row.reason] ?? 'neutral'}>
                {t(suppressionAffordance(row, role, now).reasonKey)}
              </Badge>
            ),
          },
          {
            id: 'addedAt',
            header: t('columns.addedAt'),
            cell: (row) => (
              <time dateTime={row.created_at} className="font-mono text-meta text-text-muted">
                {format.dateTime(new Date(row.created_at), 'short')}
              </time>
            ),
          },
          { id: 'action', header: t('columns.action'), cell: (row) => renderAction(row) },
        ]}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => setRemoving(open ? removing : null)}
        level="N2"
        title={
          removing?.kind === 'bulk'
            ? t('suppressions.bulkRemoveTitle', { count: summary.removable })
            : t('suppressions.removeTitle', { email: removing?.row.masked_email ?? '' })
        }
        consequences={
          removing?.kind === 'bulk'
            ? [
                t('suppressions.bulkRemoveConsequenceSend'),
                t('suppressions.bulkRemoveConsequenceAudit'),
              ]
            : [t('suppressions.removeConsequenceSend'), t('suppressions.removeConsequenceAudit')]
        }
        // Poznámka je povinná i na serveru (`z.string().min(1)`), takže ji obrazovka
        // musí opravdu vybrat od uživatele. Dřív posílala prázdný řetězec a odebrání
        // skončilo na 422 pokaždé, ručně i hromadně.
        note={{
          label: t('suppressions.removeNote'),
          hint: t('suppressions.removeNoteHint'),
          value: removeNote,
          onChange: setRemoveNote,
          missingReason: t('suppressions.removeNoteMissing'),
        }}
        confirmLabel={
          removing?.kind === 'bulk'
            ? t('suppressions.bulkRemoveConfirm')
            : t('suppressions.removeConfirm')
        }
        cancelLabel={
          removing?.kind === 'bulk'
            ? t('suppressions.bulkRemoveCancel')
            : t('suppressions.removeCancel')
        }
        labels={confirmLabels}
        onConfirm={() => void submitRemoval()}
      />
    </>
  );
}
