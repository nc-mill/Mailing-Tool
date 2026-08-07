'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { useFieldTypeLabel } from '@/lib/ui/field-type-label';
import { MoreIcon } from '@/lib/ui/status-icons';
import { BulkRemovalAction, runBulkRemoval } from '@/lib/ui/bulk-removal';
import { archiveFieldAction, deleteFieldAction, loadFieldImpactAction } from './actions';
import { NewFieldDialog } from './new-field-dialog';
import { RenameFieldDialog } from './rename-field-dialog';
import { fieldUsage } from './field-usage';
import type { FieldImpact } from './field-impact';
import { useContactsTableLabels } from './table-labels';

export type { FieldImpact };

export type ContactFieldRow = {
  id: string;
  key: string;
  /** Popisek v jazyce rozhraní. Tenhle vidí uživatel v tabulce. */
  label: string;
  /**
   * Popisek ve VŠECH jazycích, jak ho vydává API.
   *
   * Přejmenování posílá celou mapu a přepisuje v ní jen jazyk rozhraní, jinak by
   * česká úprava zahodila anglický popisek nastavený přes API. Viz
   * `field-labels.ts`.
   */
  labels: Record<string, string>;
  type: string;
  indexed: boolean;
  archived: boolean;
};

/** Akce, které řádek pole nabízí. Pořadí je i pořadím v nabídce. */
type FieldRowAction = 'rename' | 'archive' | 'delete';

/**
 * Nabídka „…" v řádku pole, tvarem shodná s kontakty a seznamy.
 *
 * PROČ NABÍDKA A NE ŘADA IKON: akce jsou tři a dvě z nich, přejmenování
 * a archivace, nemají ustálenou ikonu, kterou by šlo přečíst bez textu. Řada
 * ikon by tedy jméno akce odsunula do bubliny, kde ho ukazatel najde až po
 * prodlevě a dotyk nikdy. Nabídka jméno ponechá jako viditelný text, oddělí
 * mazání vodorovnou čarou a je to týž tvar, jaký uživatel zná z kontaktů
 * a ze seznamů: čtvrtý způsob řádkových akcí v produktu nevzniká.
 *
 * Do 7. 8. 2026 tu stály tři tlačítka přes celou šířku buňky a mezi nimi
 * čtyřřádkové vysvětlení archivace, takže sloupec akcí byl vyšší než celý
 * zbytek řádku.
 *
 * Okna kreslí tabulka, ne řádek: obsah rozbalené nabídky se při volbě položky
 * odpojí z DOM a odnesl by okno s sebou dřív, než by se ukázalo.
 */
function FieldRowMenu({
  row,
  onAction,
}: {
  row: ContactFieldRow;
  onAction: (action: FieldRowAction, row: ContactFieldRow) => void;
}) {
  const t = useTranslations('contacts');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          // Jméno akce zůstává v `aria-label`, ne jen v bublině: bez něj by
          // čtečka přečetla „tlačítko" a hlasové ovládání by spouštěč nenašlo.
          // `IconButton` z něj dělá i `title`, takže bublina vznikne sama.
          label={t('fields.rowMenu', { label: row.label })}
          data-testid={`field-row-menu-${row.key}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů
           * a seznamů. Tlačítko o straně 44 px by řádek natáhlo a rozešlo by se
           * s rytmem ostatních tabulek; plochu proto roztahuje neviditelný překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Přejmenování stojí PRVNÍ a je nejtišší akce z té trojice: špatně
            pojmenované pole se nejčastěji opravuje, ne maže. Bez něj bylo omylem
            založené pole v projektu napořád. */}
        <DropdownMenuItem onSelect={() => onAction('rename', row)}>
          {t('fields.rename')}
        </DropdownMenuItem>
        {/* Archivovat archivované pole nejde, takže se to ani nenabízí. */}
        {row.archived ? null : (
          <DropdownMenuItem onSelect={() => onAction('archive', row)}>
            {t('fields.archive')}
          </DropdownMenuItem>
        )}
        {/* Oddělovač před červenou akcí, stejně jako u kontaktů a štítků: mazání
            nemá stát v jedné řadě s přejmenováním, ať se netrefí omylem. Za
            položkou navíc pořád stojí okno úrovně N3 se zaškrtávátkem, takže
            zmenšení akce na položku v nabídce nezlevnilo samotné smazání. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" onSelect={() => onAction('delete', row)}>
          {t('fields.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FieldsTable({
  workspaceId,
  fields,
  limits,
  locale,
}: {
  /** Projekt pro archivaci, smazání a načtení dopadu. Bez něj API vrátí 404. */
  workspaceId: string;
  fields: ContactFieldRow[];
  limits: { fields: number; indexed: number };
  /** Jazyk rozhraní. Přejmenování přepisuje popisek jen v něm. */
  locale: string;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const confirmLabels = useConfirmDialogLabels();
  const toast = useToast();
  const typeLabel = useFieldTypeLabel();
  const labels = useContactsTableLabels({
    selectRow: t('fields.label'),
    selectAllOnPage: t('fields.title'),
    // Pruh výběru nesmí nad vlastními poli mluvit o kontaktech.
    selectionWording: 'generic',
  });
  const [deleting, setDeleting] = useState<{ field: ContactFieldRow; impact: FieldImpact } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ContactFieldRow | null>(null);
  const [archiving, setArchiving] = useState<ContactFieldRow | null>(null);
  /*
   * Výběr řádků. `DataTable` kreslí zaškrtávátka VŽDYCKY a vypnout se nedají, takže
   * je tabulka polí měla od začátku, jenže výběr nikam nevedl.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** `clearToken` pro tabulku: režim „vybráno všech N" bydlí uvnitř ní. */
  const [clearedSelections, setClearedSelections] = useState(0);

  const usage = fieldUsage({ fields, limits });

  /*
   * HROMADNĚ SE ARCHIVUJE, NEMAŽE, A JE TO VĚDOMÉ ROZHODNUTÍ.
   *
   * Mazání pole se u JEDNOHO řádku ptá až poté, co si vyzvedne dopad
   * (`loadFieldImpactAction`): kolika kontaktů se to dotkne a jestli pole nedrží
   * naplánovaná kampaň, ve které by pak chyběla značka. Nad výběrem se tahle věta
   * říct nedá, protože u každého pole zní jinak, a vypsat dvanáct dopadů do jednoho
   * okna znamená okno, které nikdo nepřečte. Hromadné mazání by tedy muselo dopad
   * zamlčet, a to je přesně ten tichý částečný úspěch, kterému se tady vyhýbáme.
   *
   * Archivace tenhle problém nemá: hodnoty u kontaktů zůstávají, segmenty i hotové
   * šablony dál fungují a pole jen zmizí z nabídek. Následek je u všech polí týž,
   * takže se dá pojmenovat jednou větou pro celý výběr.
   */
  const selected = fields.filter((row) => selectedIds.includes(row.id));
  const archivable = selected.filter((row) => !row.archived);
  const skippedFields = selected.length - archivable.length;

  async function archiveSelected(): Promise<{ failed: number; detail: string | null }> {
    const { failedIds, detail } = await runBulkRemoval(
      archivable.map((row) => row.id),
      (id) => archiveFieldAction({ workspaceId, id }),
    );
    router.refresh();
    if (failedIds.length === 0) {
      toast.success(t('fields.bulkArchiveDone', { count: archivable.length }));
      // Výběr se ruší JEN po úspěchu. Zůstávají v něm pole, která se archivovat
      // ani nezkoušela, protože archivovaná už jsou.
      setSelectedIds(selected.filter((row) => row.archived).map((row) => row.id));
      setClearedSelections((count) => count + 1);
      return { failed: 0, detail: null };
    }
    setSelectedIds([...failedIds, ...selected.filter((row) => row.archived).map((row) => row.id)]);
    setClearedSelections((count) => count + 1);
    return { failed: failedIds.length, detail };
  }

  async function openDelete(field: ContactFieldRow) {
    // Dopad se načítá až při otevření dialogu. Načítat ho u každého řádku dopředu
    // by znamenalo tolik dotazů, kolik je polí, a uživatel ho u většiny nikdy neuvidí.
    const result = await loadFieldImpactAction({ workspaceId, id: field.id });
    if (result.status === 'success') setDeleting({ field, impact: result.impact });
  }

  /** Volba z řádkové nabídky. Každá ze tří akcí otevírá okno, žádná neběží rovnou. */
  function onRowAction(action: FieldRowAction, field: ContactFieldRow) {
    switch (action) {
      case 'rename':
        setRenaming(field);
        return;
      case 'archive':
        setArchiving(field);
        return;
      case 'delete':
        void openDelete(field);
        return;
    }
  }

  async function archiveField(field: ContactFieldRow) {
    const result = await archiveFieldAction({ workspaceId, id: field.id });
    // Neúspěch se HLÁSÍ. Do 7. 8. 2026 se výsledek zahazoval, takže po chybě
    // ze serveru obrazovka jen problikla a pole v ní zůstalo stát bez vysvětlení.
    if (result.status !== 'success') {
      toast.error(t('fields.archiveFailed', { code: result.code }));
      return false;
    }
    router.refresh();
    return true;
  }

  if (fields.length === 0) {
    return (
      <>
        <EmptyState
          variant="first"
          title={t('fields.emptyTitle')}
          explanation={t('fields.emptyBody')}
          // „Přidat první pole" otevíralo dialog až od 7. 8. 2026. Do té doby
          // volalo `router.refresh()`, tedy překreslilo prázdnou obrazovku
          // prázdnou obrazovkou: tlačítko, které vypadá jako cesta dál a nikam
          // nevede, je horší než žádné tlačítko.
          actions={[{ label: t('fields.emptyAction'), onClick: () => setCreating(true) }]}
        />
        <NewFieldDialog
          open={creating}
          onOpenChange={setCreating}
          workspaceId={workspaceId}
          onCreated={() => router.refresh()}
        />
      </>
    );
  }

  const blockedByCampaign = deleting?.impact.campaigns_scheduled[0];

  return (
    <section className="flex flex-col gap-4">
      {/* NADPIS ANI ÚVODNÍ VĚTA TU NESTOJÍ: obojí vypisuje `SettingsPageShell`
          trasy `/settings/fields`, takže do 7. 8. 2026 byly na obrazovce dvakrát
          pod sebou a zabíraly čtyři řádky nad tabulkou zbytečně. */}
      <p data-testid="fields-usage">
        {t('fields.usage', { used: usage.used, limit: usage.limit })}
      </p>
      <p data-testid="fields-indexed-usage">
        {t('fields.indexedUsage', { used: usage.indexedUsed, limit: usage.indexedLimit })}
      </p>
      <p className="text-sm text-text-muted">{t('fields.usageHint')}</p>

      {/* Žádné disabled na primární akci. Na stropu se ukáže, co udělat, ne mrtvé tlačítko. */}
      <div className="flex flex-col gap-2">
        <Button variant="primary" data-testid="create-field" onClick={() => setCreating(true)}>
          {t('fields.create')}
        </Button>
        {usage.atLimit ? <p>{t('fields.limitReached')}</p> : null}
        {usage.atIndexedLimit ? <p>{t('fields.indexedLimitReached')}</p> : null}
      </div>

      <DataTable
        tableId="contact-fields"
        caption={t('fields.title')}
        rows={fields}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: fields.length, precision: 'exact' }}
        selection={{
          selectedIds: selected.map((row) => row.id),
          onSelectionChange: setSelectedIds,
          clearToken: clearedSelections,
        }}
        bulkActions={
          <BulkRemovalAction
            testId="fields-bulk"
            removable={archivable.length}
            labels={{
              action: t('fields.bulkArchive', { count: archivable.length }),
              nothing: t('fields.bulkArchiveNothing'),
              title: t('fields.bulkArchiveTitle', { count: archivable.length }),
              // TYTÉŽ VĚTY JAKO U JEDNOHO POLE, plus věta o tom, proč se hromadně
              // maže archivací a ne mazáním. Bez ní by uživatel hledal „Smazat"
              // a nenašel by ani vysvětlení, ani cestu.
              explanation: [
                t('fields.archiveConsequenceMenus'),
                t('fields.archiveConsequenceValues'),
                t('fields.bulkDeleteHint'),
              ],
              ...(skippedFields > 0
                ? { skipped: t('fields.bulkArchiveSkipped', { count: skippedFields }) }
                : {}),
              submit: t('fields.bulkArchive', { count: archivable.length }),
              submitting: t('fields.bulkArchiveSubmitting'),
              cancel: t('fields.archiveCancel'),
              failed: ({ failed, detail }) =>
                t('fields.bulkArchiveFailed', { count: failed, detail: detail ?? '' }),
            }}
            onConfirm={archiveSelected}
          />
        }
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          { id: 'label', header: t('fields.label'), cell: (row) => row.label },
          { id: 'key', header: t('fields.key'), cell: (row) => row.key },
          // Typ se ukazuje POJMENOVANÝ, ne jak stojí v databázi. `boolean` ve
          // sloupci nikomu neřeklo, co se do pole zadává; „Ano/ne" ano.
          { id: 'type', header: t('fields.type'), cell: (row) => typeLabel(row.type) },
          {
            id: 'indexed',
            header: t('fields.indexed'),
            cell: (row) => (row.indexed ? t('lists.doubleOptInOn') : t('lists.doubleOptInOff')),
          },
          {
            id: 'action',
            header: t('columns.action'),
            width: 60,
            cell: (row) => (
              <span className="flex justify-end">
                <FieldRowMenu row={row} onAction={onRowAction} />
              </span>
            ),
          },
        ]}
      />

      <NewFieldDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        // Nové pole se nedosazuje do stavu komponenty, vyžádá se od serveru:
        // tabulka je vykreslená ze serverové komponenty a druhá pravda o tom,
        // co v projektu je, by se s ní rozešla u limitů i u pořadí.
        onCreated={() => router.refresh()}
      />

      <RenameFieldDialog
        field={renaming}
        workspaceId={workspaceId}
        locale={locale}
        onOpenChange={(open) => setRenaming(open ? renaming : null)}
        onRenamed={() => router.refresh()}
      />

      {/*
        VYSVĚTLENÍ ARCHIVACE STOJÍ TADY, ne ve sloupci akcí. Věta „hodnoty
        zůstanou a segmenty dál fungují" není popiska tlačítka, je to následek,
        a nejvíc platí ve chvíli, kdy se člověk rozhoduje. V buňce ji každý
        řádek opakoval znovu a nikdo ji nečetl.

        ÚROVEŇ JE N2 podle os z 6.1: rozsah 0 (jedno pole), obnovitelnost 1
        (hodnoty i `archived_at` zůstávají v databázi, ale cesta zpět neexistuje
        ani v rozhraní, ani v API: `PATCH /contact-fields/{id}` je `strict`
        a archivaci neumí odklepnout), vnější dopad 1 (pole zmizí z nabídek
        všem v projektu, ne jen tomu, kdo klikl). Součet 2 je N2, tedy okno
        s výčtem následků, bez zaškrtávátka a bez opisování.

        NÁSLEDKY JSOU OVĚŘENÉ V KÓDU: `archiveContactField` v
        `repo/contact-fields.ts` nastaví jen `archived_at`, `listContactFields`
        bez `includeArchived` pole nevrátí, a `getFieldCatalog` ho označí
        `deleted`, takže zmizí z nabídky značek v editoru, ale hotové šablony
        dál projdou validací.
      */}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => setArchiving(open ? archiving : null)}
        level="N2"
        // NENÍ destruktivní: hodnoty u kontaktů zůstávají, segmenty i šablony dál
        // fungují, pole jen zmizí z nabídek. Archivace je bezpečná cesta vedle
        // mazání a červená by ty dvě od sebe přestala odlišovat.
        destructive={false}
        title={t('fields.archiveTitle', { label: archiving?.label ?? '' })}
        consequences={[t('fields.archiveConsequenceMenus'), t('fields.archiveConsequenceValues')]}
        confirmLabel={t('fields.archiveConfirm')}
        cancelLabel={t('fields.archiveCancel')}
        labels={confirmLabels}
        onConfirm={async () => {
          if (!archiving) return;
          if (await archiveField(archiving)) setArchiving(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => setDeleting(open ? deleting : null)}
        level="N3"
        // Červená jen u skutečného mazání. Když pole drží naplánovaná kampaň,
        // je jedinou dopřednou akcí archivace a ta se jako mazání tvářit nesmí.
        destructive={blockedByCampaign === undefined}
        title={t('fields.deleteTitle', { label: deleting?.field.label ?? '' })}
        consequences={
          blockedByCampaign
            ? [t('fields.deleteBlockedByCampaign', { campaign: blockedByCampaign.name })]
            : [
                t('fields.deleteImpactContacts', {
                  count: deleting?.impact.contacts_with_value ?? 0,
                }),
                t('fields.deleteImpactTemplates', {
                  count: deleting?.impact.templates.length ?? 0,
                }),
                t('fields.deleteImpactSegments', { count: deleting?.impact.segments.length ?? 0 }),
                t('fields.deleteImpactForms', { count: deleting?.impact.forms.length ?? 0 }),
              ]
        }
        irreversible={blockedByCampaign === undefined}
        // Smazání pole drženého naplánovanou kampaní končí 409. Rozhraní ho proto
        // vůbec nenabídne: jediná dopředná akce v dialogu je archivace, a proč,
        // to říká věta ve výčtu následků.
        {...(blockedByCampaign ? {} : { acknowledgement: t('fields.deleteAck') })}
        confirmLabel={
          blockedByCampaign ? t('fields.deleteSuggestArchive') : t('fields.deleteConfirm')
        }
        cancelLabel={t('fields.deleteCancel')}
        extraAction={
          // Následky archivace tady znovu nestojí: tenhle dialog vypisuje následky
          // SMAZÁNÍ a člověk se rozhoduje mezi nimi a tím, že se nestane nic.
          // Druhý výčet by ten první přehlušil.
          blockedByCampaign ? null : (
            <Button
              variant="secondary"
              onClick={async () => {
                if (!deleting) return;
                if (await archiveField(deleting.field)) setDeleting(null);
              }}
            >
              {t('fields.deleteSuggestArchive')}
            </Button>
          )
        }
        labels={confirmLabels}
        onConfirm={async () => {
          if (!deleting) return;
          if (blockedByCampaign) {
            if (await archiveField(deleting.field)) setDeleting(null);
            return;
          }
          const result = await deleteFieldAction({ workspaceId, id: deleting.field.id });
          if (result.status === 'success') {
            setDeleting(null);
            router.refresh();
          }
        }}
      />
    </section>
  );
}
