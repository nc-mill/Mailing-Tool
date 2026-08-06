'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Plus } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { MoreIcon } from '@/lib/ui/status-icons';
import { createTagAction, deleteTagAction, mergeTagsAction, renameTagAction } from './actions';
import { ContactExportDialog, useContactExport } from './contact-export';
import { tagToAudience } from './export-audience';

export type TagRow = { id: string; name: string; contact_count: number };

/**
 * Mřížka řádku: název, počet, nabídka. Stejná definice pro hlavičku i pro řádky,
 * jinak by se sloupce rozjely. Poslední sloupec je široký jako klikací plocha
 * nabídky, tedy 44 px, ne 34 px z návrhu: přístupnost má přednost a platí to
 * napříč aplikací stejně.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_160px_var(--size-target-min)] items-center gap-[var(--spacing-stack)] px-[var(--spacing-row-x)]';

/**
 * Obrazovka štítků.
 *
 * PROČ TO NENÍ TABULKA. Do 5. 8. 2026 tu byla `DataTable` se zaškrtávátky,
 * stránkováním a nastavením sloupců. Štítek má přitom jen dva údaje, název
 * a počet kontaktů, takže ze čtyř sloupců byly dva na výběr a na tlačítka.
 * Stránka navíc načítá štítky jedním požadavkem bez kurzoru, takže „Předchozí"
 * a „Další" byly trvale zašedlé a „Nastavení sloupců" nabízelo skrývání dvou
 * sloupců, bez kterých obrazovka nedává smysl. Tři ovládací prvky, které
 * nedělaly nic, tedy nebyly vada kódu, ale vada tvaru.
 *
 * Seznam karet je tvar, který v tomhle produktu už má **segment**
 * (`features/segments/segment-list.tsx`), a segment je se štítkem dvojče:
 * jeden se počítá sám, druhý přiřazuje člověk. Obě obrazovky proto vypadají
 * stejně: odkaz vlevo, číslo vpravo, akce na konci řádku.
 *
 * VÝBĚR ZMIZEL CELÝ. Zaškrtávátka tu byla kvůli slučování a jinou hromadnou
 * akci štítky nemají. Sloučení je dnes položka nabídky u konkrétního štítku
 * („sloučit tenhle do jiného"), což je i srozumitelnější věta než „zaškrtni
 * dva a pak vyber, který zůstane". Odpadl tím i popisek lišty výběru, který
 * nad štítky hlásil „Vybrán 1 kontakt".
 */
export function TagsScreen({
  workspaceId,
  basePath,
  tags,
  hasMore = false,
}: {
  workspaceId: string;
  /** Kořen projektu, například `/w/petr-osobni-mail`. Skládá se z něj odkaz na kontakty. */
  basePath: string;
  tags: TagRow[];
  /** Server vrátil další stránku. Seznam ji neumí dojít, tak to aspoň řekne nahlas. */
  hasMore?: boolean;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPending, setCreatePending] = useState(false);
  const [createFailed, setCreateFailed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TagRow | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renamePending, setRenamePending] = useState(false);
  const [renameFailed, setRenameFailed] = useState<string | null>(null);
  /** Slučování má dva kroky: vybrat cíl a potvrdit nevratnou akci. */
  const [mergeSource, setMergeSource] = useState<TagRow | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const contactExport = useContactExport(workspaceId);

  const contactsHref = (tagId: string) =>
    `${basePath}/contacts?tag_id=${encodeURIComponent(tagId)}`;
  const mergeTarget = tags.find((tag) => tag.id === mergeTargetId) ?? null;

  async function submitCreate() {
    const name = createName.trim();
    if (name === '') return;
    setCreatePending(true);
    setCreateFailed(null);
    const result = await createTagAction({ workspaceId, name });
    setCreatePending(false);
    if (result.status !== 'success') {
      setCreateFailed(
        result.code === 'already_exists' ? t('tags.createDuplicate') : t('tags.createFailed'),
      );
      return;
    }
    toast.success(t('tags.created', { name }));
    setCreateOpen(false);
    setCreateName('');
    router.refresh();
  }

  function openRename(tag: TagRow) {
    setRenameFailed(null);
    setRenameName(tag.name);
    setRenaming(tag);
  }

  async function submitRename() {
    if (renaming === null) return;
    const name = renameName.trim();
    if (name === '') return;
    setRenamePending(true);
    setRenameFailed(null);
    const result = await renameTagAction({ workspaceId, id: renaming.id, name });
    setRenamePending(false);
    if (result.status !== 'success') {
      setRenameFailed(
        result.code === 'already_exists' ? t('tags.renameDuplicate') : t('tags.renameFailed'),
      );
      return;
    }
    toast.success(t('tags.renamed', { name }));
    setRenaming(null);
    router.refresh();
  }

  function openMerge(tag: TagRow) {
    setMergeTargetId(null);
    setMergeSource(tag);
  }

  async function submitMerge() {
    if (mergeSource === null || mergeTarget === null) return;
    const source = mergeSource;
    const target = mergeTarget;
    const result = await mergeTagsAction({
      workspaceId,
      sourceIds: [source.id],
      targetId: target.id,
    });
    setMergeConfirm(false);
    setMergeSource(null);
    if (result.status !== 'success') {
      toast.error(t('tags.mergeFailed', { detail: result.code }));
      router.refresh();
      return;
    }
    toast.success(t('tags.mergeDone', { source: source.name, target: target.name }));
    router.refresh();
  }

  async function submitDelete() {
    if (deleting === null) return;
    const tag = deleting;
    const result = await deleteTagAction({ workspaceId, id: tag.id });
    setDeleting(null);
    if (result.status !== 'success') {
      toast.error(t('tags.deleteFailed', { detail: result.code }));
      return;
    }
    toast.success(t('tags.deleted', { name: tag.name }));
    router.refresh();
  }

  /** Export kontaktů štítku. Celý sled od založení po stažení drží `useContactExport`. */
  function startExport(tag: TagRow) {
    void contactExport.start({
      title: t('tags.exportTitle', { name: tag.name }),
      fileName: tag.name,
      outcome: { ok: true, audience: tagToAudience(tag.id) },
    });
  }

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogTitle>{t('tags.createTitle')}</DialogTitle>
      <DialogBody>
        <p className="text-ui text-text-muted">{t('tags.createBody')}</p>
        <Field label={t('tags.createName')} hint={t('tags.createNameHint')}>
          <Input value={createName} onChange={(event) => setCreateName(event.target.value)} />
        </Field>
        {createFailed === null ? null : <Alert tone="error" title={createFailed} />}
      </DialogBody>
      <DialogFooter
        retreat={<Button onClick={() => setCreateOpen(false)}>{t('tags.createCancel')}</Button>}
        confirm={
          // Prázdný název tlačítko NEZAŠEDÍ (princip P5): zůstane klikatelné
          // a pod ním je věta, co chybí.
          <Button
            variant="primary"
            pending={createPending}
            {...(createName.trim() === '' ? { unavailableReason: t('tags.nameMissing') } : {})}
            onClick={() => void submitCreate()}
          >
            {t('tags.createConfirm')}
          </Button>
        }
      />
    </Dialog>
  );

  /**
   * Hlavička. V prázdném stavu je BEZ tlačítka: prázdný stav svoje „Přidat první
   * štítek" nabízí sám a dvě tlačítka pro tutéž akci pár centimetrů od sebe nutí
   * uživatele hledat rozdíl, který neexistuje.
   */
  const header = (withAction: boolean) => (
    <PageHeader
      title={t('tags.title')}
      description={t('tags.lead')}
      {...(withAction
        ? {
            actions: (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="icon-md" />
                {t('tags.create')}
              </Button>
            ),
          }
        : {})}
    />
  );

  if (tags.length === 0) {
    return (
      <>
        {header(false)}
        {/* Akce prázdného stavu dřív jen obnovila stránku, takže první štítek nešel
            založit vůbec: prázdný stav je jediné místo, kde se v té chvíli je. */}
        <EmptyState
          variant="first"
          title={t('tags.emptyTitle')}
          explanation={t('tags.emptyBody')}
          actions={[{ label: t('tags.emptyAction'), onClick: () => setCreateOpen(true) }]}
        />
        {createDialog}
      </>
    );
  }

  return (
    <>
      {header(true)}
      {createDialog}

      <div className="flex min-w-0 flex-col gap-[var(--spacing-gutter)]">
        {/*
         * Karta s hlavičkou sloupců a řádky, TÝŽ TVAR JAKO SEZNAM SEGMENTŮ.
         *
         * Štítek a segment jsou dvojčata: jeden se počítá sám, druhý přiřazuje
         * člověk, ale obojí je pojmenovaná skupina lidí s číslem a s akcemi na
         * konci řádku. Když se ty dvě obrazovky liší tvarem, vypadá to, že se liší
         * i významem. Řada samostatných karet, která tu byla předtím, navíc nechala
         * číslo viset bez hlavičky, takže se dalo přečíst až po slově „kontakty".
         *
         * Není to `DataTable`: ta má zaškrtávátka, stránkování a nastavení sloupců,
         * a všechny tři jsou tu k ničemu. Právě kvůli tomu se obrazovka jednou
         * z tabulky přepsala a zpátky nepůjde.
         */}
        <Card padding="none" gap="none">
          <div className="overflow-x-auto rounded-t-[var(--radius-surface)]">
            <div className="min-w-[520px]">
              <div
                className={`${COLUMNS} rounded-t-[var(--radius-surface)] border-b border-border bg-surface-muted py-3`}
              >
                <span className="meta-caps text-text-muted">{t('tags.columnName')}</span>
                <span className="meta-caps text-right text-text-muted">
                  {t('tags.columnContacts')}
                </span>
                <span />
              </div>

              {tags.map((tag) => (
                <div
                  key={tag.id}
                  data-testid={`tag-${tag.id}`}
                  className={`${COLUMNS} items-center border-b border-border py-3 last:border-b-0 hover:bg-surface-muted`}
                >
                  {/* Název je odkaz na kontakty se štítkem. Samostatná obrazovka detailu by
                      ukazovala tentýž seznam s jiným nadpisem: filtr `tag_id` na seznamu
                      kontaktů existuje a umí nad nálezem i hromadné akce. */}
                  <Link
                    href={contactsHref(tag.id)}
                    aria-label={t('tags.openContacts', { name: tag.name })}
                    className="justify-self-start text-base font-semibold text-text no-underline hover:underline"
                  >
                    {tag.name}
                  </Link>

                  {/* Počet je číslo, takže mono a zarovnaný doprava: pod sebou pak
                      čísla stojí na stejném místě a dají se porovnat pohledem. */}
                  <span className="text-right font-mono text-ui text-text-muted">
                    {t('tags.contacts', { count: tag.contact_count })}
                  </span>

                  {/* Jedna nabídka místo řady tlačítek u každého řádku. Akce jsou čtyři
                      a vedle sebe by z každého řádku udělaly lištu nástrojů, ve které se
                      ztratí to podstatné, tedy název štítku a počet kontaktů. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t('tags.rowMenu', { name: tag.name })}
                      className="flex size-[var(--size-target-min)] items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-transparent text-text-muted hover:border-border-strong hover:bg-surface-raised hover:text-text"
                    >
                      {MoreIcon}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openRename(tag)}>
                        {t('tags.rename')}
                      </DropdownMenuItem>
                      {/* Export prázdného štítku by vyrobil soubor s hlavičkou a ničím
                          dalším, sloučit není co do čeho, když je štítek v projektu sám.
                          Obojí se proto nenabízí, místo aby to skončilo chybou. */}
                      {tag.contact_count > 0 ? (
                        <DropdownMenuItem onSelect={() => startExport(tag)}>
                          {t('tags.export')}
                        </DropdownMenuItem>
                      ) : null}
                      {tags.length > 1 ? (
                        <DropdownMenuItem onSelect={() => openMerge(tag)}>
                          {t('tags.merge')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem tone="danger" onSelect={() => setDeleting(tag)}>
                        {t('tags.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Seznam bere prvních dvě stě štítků jedním požadavkem a další stránku nedojde.
            Mlčet o tom by znamenalo tvrdit, že projekt žádné další štítky nemá. */}
        {hasMore ? <p className="text-meta text-text-muted">{t('tags.truncated')}</p> : null}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => setRenaming(open ? renaming : null)}>
        <DialogTitle>{t('tags.renameTitle', { name: renaming?.name ?? '' })}</DialogTitle>
        <DialogBody>
          <Field label={t('tags.renameName')} hint={t('tags.renameHint')}>
            <Input value={renameName} onChange={(event) => setRenameName(event.target.value)} />
          </Field>
          {renameFailed === null ? null : <Alert tone="error" title={renameFailed} />}
        </DialogBody>
        <DialogFooter
          retreat={<Button onClick={() => setRenaming(null)}>{t('tags.renameCancel')}</Button>}
          confirm={
            <Button
              variant="primary"
              pending={renamePending}
              {...(renameName.trim() === '' ? { unavailableReason: t('tags.nameMissing') } : {})}
              onClick={() => void submitRename()}
            >
              {t('tags.renameConfirm')}
            </Button>
          }
        />
      </Dialog>

      {/*
       * Slučování má dva kroky schválně.
       *
       * Cíl se vybírá v obyčejném dialogu, protože `ConfirmDialog` nemá kam nabídku
       * pustit: bere `consequences`, `note` a `acknowledgement`, žádný volný obsah.
       * Následky se přitom bez vybraného cíle nedají napsat konkrétně, a obecná věta
       * „Akce bude provedena" je přesně to, co potvrzovací dialog v tomhle produktu
       * mít nesmí. První krok tedy vybírá, druhý potvrzuje nevratné.
       */}
      <Dialog
        open={mergeSource !== null && !mergeConfirm}
        onOpenChange={(open) => (open ? undefined : setMergeSource(null))}
      >
        <DialogTitle>{t('tags.mergeTitle', { source: mergeSource?.name ?? '' })}</DialogTitle>
        <DialogBody>
          <p className="text-ui text-text-muted">
            {t('tags.mergeBody', { source: mergeSource?.name ?? '' })}
          </p>
          <div className="flex flex-col gap-1.5">
            {/* Není to `Field`: `Select` má vlastní `aria-label` a `Field` by
                klonoval `id` do prvku, který ho na spouštěči nečeká. Popisek nad
                nabídkou proto stojí samostatně a má stejný vzhled jako popisek pole. */}
            <span className="text-sm font-semibold text-text">{t('tags.mergeTarget')}</span>
            <Select
              aria-label={t('tags.mergeTarget')}
              placeholder={t('tags.mergeTargetPlaceholder')}
              {...(mergeTarget === null ? {} : { value: mergeTarget.id })}
              onValueChange={setMergeTargetId}
            >
              {tags
                .filter((tag) => tag.id !== mergeSource?.id)
                .map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
            </Select>
          </div>
        </DialogBody>
        <DialogFooter
          retreat={<Button onClick={() => setMergeSource(null)}>{t('tags.mergeCancel')}</Button>}
          confirm={
            <Button
              variant="primary"
              {...(mergeTarget === null ? { unavailableReason: t('tags.mergeTargetMissing') } : {})}
              onClick={() => setMergeConfirm(true)}
            >
              {t('tags.mergeContinue')}
            </Button>
          }
        />
      </Dialog>

      <ConfirmDialog
        open={mergeConfirm}
        // Ústup z potvrzení ruší CELÉ slučování, ne jen druhý krok. Vrátit se do
        // výběru cíle by znamenalo dvě „Zrušit" za sebou, kde první zruší něco
        // jiného než druhé; kdo si spletl cíl, otevře nabídku znovu.
        onOpenChange={(open) => {
          setMergeConfirm(open);
          if (!open) setMergeSource(null);
        }}
        level="N3"
        title={t('tags.mergeConfirmTitle', {
          source: mergeSource?.name ?? '',
          target: mergeTarget?.name ?? '',
        })}
        consequences={[
          // `source` se předává, i když ho věta při nenulovém počtu nepoužije: větev
          // `=0` na něj sahá, a chybějící proměnná je u ICU chyba, ne prázdné místo.
          // Dialogy se navíc vykreslují i zavřené, takže by hlásila hned po načtení.
          t('tags.mergeConsequenceContacts', {
            count: mergeSource?.contact_count ?? 0,
            source: mergeSource?.name ?? '',
            target: mergeTarget?.name ?? '',
          }),
          t('tags.mergeConsequenceGone', { source: mergeSource?.name ?? '' }),
        ]}
        acknowledgement={t('tags.mergeAck')}
        confirmLabel={t('tags.mergeConfirmAction')}
        cancelLabel={t('tags.mergeCancel')}
        labels={confirmLabels}
        onConfirm={() => void submitMerge()}
      />

      {/*
       * MAZÁNÍ MÁ POTVRZENÍ, ne nabídku „Vrátit zpět".
       *
       * Původní kód se odvolával na úroveň N1, tedy vratnou akci, jenže `deleteTag`
       * maže řádek natvrdo (`DELETE FROM tags`) a kaskádou s ním i přiřazení kontaktů.
       * Endpoint na obnovení neexistuje, takže tlačítko „Vrátit zpět" v oznámení jen
       * obnovilo stránku a štítek se nevrátil. Nevratná akce patří do N2 s výčtem
       * následků; slíbit vrácení a nesplnit ho je horší než se zeptat.
       */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => setDeleting(open ? deleting : null)}
        level="N2"
        title={t('tags.deleteTitle', { name: deleting?.name ?? '' })}
        consequences={[
          t('tags.deleteConsequenceContacts', { count: deleting?.contact_count ?? 0 }),
          t('tags.deleteConsequenceGone'),
        ]}
        confirmLabel={t('tags.deleteConfirm')}
        cancelLabel={t('tags.deleteCancel')}
        labels={confirmLabels}
        onConfirm={() => void submitDelete()}
      />

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />
    </>
  );
}
