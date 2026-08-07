'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { ChevronDown, CircleCheckBig, Download, List, Tag, Trash2 } from '@mlain/ui/icons';
// K5 z 13.1 části 6: fronta oznámení, odpočet u „Vrátit zpět", chyba se nezavírá sama.
import { useToast } from '@mlain/ui/patterns/toast';
import { BulkDeleteDialog } from './bulk-delete-dialog';
import { RemoveTagDialog } from './remove-tag-dialog';
import { bulkDeleteContactsAction, bulkTagContactsAction } from './actions';
import { ContactExportDialog, exportAndDownload, useContactExport } from './contact-export';
import { emailsToAudience, filtersToAudience } from './export-audience';
import { confirmContactsAction } from './confirm-actions';
import { addContactsToListAction, removeContactsFromListAction } from './list-actions';
import { RemoveFromListDialog } from './remove-from-list-dialog';
import type { BulkScope } from './actions';
import { useFilterChips } from './filter-chips';
import type { ContactListFilters, FilterNames } from './filters';
import type { Selection } from './contacts-table';

export type ContactsBulkActionsProps = {
  /**
   * Projekt pro serverové akce. Bez něj jde požadavek bez hlavičky `X-Workspace-Id`,
   * RLS nevrátí ani řádek a hromadné smazání i export skončí na 404.
   */
  workspaceId: string;
  selection: Selection;
  filters: ContactListFilters;
  names: FilterNames;
  /** Štítky projektu pro rychlé přiřazení. Prázdné pole nabídku štítků skryje. */
  tags?: { id: string; name: string }[];
  /**
   * Adresy zaškrtnutých kontaktů. Publikum exportu umí vyjmenovat kontakty jen
   * e-mailem, id do něj nepatří; podrobně u `emailsToAudience`.
   */
  selectedEmails?: string[];
  /**
   * Seznamy projektu pro hromadné přidání. Prázdné pole nabídku seznamů skryje.
   *
   * Nabídka bez tlačítka tu do téhle chvíle nebyla vůbec, ačkoliv popisky
   * `bulk.addToList` a `bulk.removeFromList` v katalozích ležely od začátku.
   */
  lists?: { id: string; name: string }[];
  /**
   * Seznamy, ve kterých je každý označený kontakt JEŠTĚ PŘIHLÁŠENÝ, jedno pole na kontakt.
   *
   * Slouží k jedinému: spočítat, kolik kontaktů po odhlášení nezůstane v žádném seznamu.
   * Jádro to nezakazuje (`lists` je v `ContactUpsertRequest` nepovinné a žádná podmínka
   * minimálního počtu tam není), takže se to nedá zarazit chybou ze serveru. Říct se to
   * ale musí nahlas, jinak akce tiše vyrobí kontakty, na které se nedá dosáhnout žádným
   * seznamem. Bere se z toho, co je na obrazovce; další dotaz na server kvůli tomu nemá
   * smysl posílat.
   */
  selectedSubscriptions?: string[][];
  /**
   * Akce doběhla ÚSPĚŠNĚ a výběr se má uklidit.
   *
   * Nález z provozu: „Vyberu nějaké kontakty, udělám nad nimi operaci. Ta proběhne,
   * ale tohle tam zůstane viset. Pokud kontakty smažu, tak nemá co s tím dál dělat."
   * Po akci se do téhle chvíle volalo jen `router.refresh()`, takže se obnovila DATA,
   * ale výběr zůstal, a to i po smazání, kdy v něm ležely identifikátory kontaktů,
   * které už neexistují.
   *
   * VOLÁ SE JEN Z ÚSPĚŠNÉ VĚTVE. Po chybě výběr zůstává schválně: uživatel by jinak
   * přišel o odklikanou práci a musel označovat znovu (zákaz z 6.7).
   */
  onCompleted?: () => void;
};

/**
 * HROMADNÉ AKCE STOJÍ NA TMAVÉM PANELU, ne na papíře.
 *
 * `SelectionBar` je v návrhu tmavý pruh, takže sekundární tlačítko v jeho výchozí
 * podobě (tmavý text a tmavá hrana) by na něm bylo prakticky neviditelné. Přebarvuje
 * se proto na světlý obrys, jak je to v návrhu Kontaktů: 36px výška, hairline rámeček
 * v `panel-soft`, text v `panel-foreground`, najetí zesvětlí plochu na `panel-line`.
 *
 * Hrana pod tlačítkem se vypíná schválně: plná spodní hrana je kresba tištěného
 * tlačítka na papíře a na tmavém pruhu nemá o co se opřít.
 */
const PANEL_BUTTON = [
  'border-panel-soft bg-transparent text-sm text-panel-foreground shadow-none',
  'hover:translate-y-0 hover:bg-panel-line hover:shadow-none',
].join(' ');

/**
 * Spouštěč nabídky na tmavém pruhu. Rozbalený obsah se portáluje na papír, proto se
 * v něm nic přebarvovat nemusí.
 *
 * VYPADÁ JAKO ROZBALOVÁTKO, ALE JE TO NABÍDKA AKCÍ, a je to schválně. Uživatel na ten
 * prvek ukazuje jako na „select" a vzhled tedy zůstává, jenže se v něm od 7. 8. 2026
 * nevybírá HODNOTA, ale AKCE („přidat štítek Brno", „odebrat štítek Brno"). Rozbalovátko,
 * jehož volba rovnou provede nevratnou operaci, je past: čtečka ho ohlásí jako výběr
 * hodnoty a klávesnice v něm mezi položkami přejíždí, takže by se odebrání spustilo
 * i jen projetím seznamu šipkami. Nabídka akcí tohle nemá.
 */
const PANEL_MENU = [
  'flex w-56 items-center justify-between gap-2 rounded-[var(--radius-control)] px-3.5',
  'h-[var(--size-control-sm)] border border-panel-soft bg-transparent',
  'text-sm text-panel-foreground disabled:cursor-not-allowed disabled:opacity-60',
  // Výška je 36 px kvůli rytmu pruhu, klikací plocha 44 px kvůli pravidlu. Týž
  // neviditelný překryv jako u filtrů nad tabulkou a u nabídky „…" v řádku.
  'relative after:absolute after:top-1/2 after:left-0 after:h-[var(--size-target-min)]',
  "after:w-full after:-translate-y-1/2 after:content-['']",
].join(' ');

export function ContactsBulkActions({
  workspaceId,
  selection,
  filters,
  names,
  tags = [],
  lists = [],
  selectedEmails = [],
  selectedSubscriptions = [],
  onCompleted,
}: ContactsBulkActionsProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * Seznam, kterého se týká otevřené okno odebrání. Není to „vybraná hodnota
   * rozbalovátka": od chvíle, kdy se akce volí přímo v nabídce, drží tenhle stav jen
   * cíl rozdělané akce, dokud ji uživatel nepotvrdí nebo neustoupí.
   */
  const [listId, setListId] = useState<string | null>(null);
  const [addingToList, setAddingToList] = useState(false);
  const [removingFromList, setRemovingFromList] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  /** Totéž pro odebrání štítku. */
  const [removeTagTarget, setRemoveTagTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeTagOpen, setRemoveTagOpen] = useState(false);
  const [removingTag, setRemovingTag] = useState(false);
  const contactExport = useContactExport(workspaceId);

  const chips = useFilterChips()(filters, names);

  /*
   * Filtr se v dialogu opakuje jen tehdy, když se maže „vše odpovídající filtru".
   * U výběru na stránce žádný filtr o rozsahu nerozhoduje a věta by mátla.
   *
   * BEZ ZAPNUTÉHO FILTRU SE TO ŘÍKÁ SLOVY, ne mlčením. „Vše odpovídající filtru"
   * nad nefiltrovaným seznamem znamená všechny kontakty projektu, a to je největší
   * možný rozsah, jaký tahle obrazovka umí spustit. Prázdné místo, kde jindy stojí
   * výčet filtru, by se dalo přečíst jako „rozsah je malý".
   */
  const filterDescription =
    selection.mode !== 'allMatching'
      ? null
      : chips.length > 0
        ? format.list(chips)
        : t('bulk.filterNone');

  /*
   * CO SE NAD CELÝM FILTREM UDĚLAT NEDÁ.
   *
   * Štítky, seznamy i povýšení na potvrzené jdou v API výhradně přes výčet
   * identifikátorů: `POST /contacts/tags:bulk` bere `filter: { contact_ids }`
   * a nic jiného, přihlášení do seznamu jede přes adresy a potvrzení po jednom
   * kontaktu. Nad statisíci řádky by to byl statisíc požadavků.
   *
   * NENABÍZEJÍ SE, MÍSTO ABY SVÍTILY ZAŠEDLE (kritérium 18 části 6). Zašedlé
   * tlačítko bez vysvětlení je zakázané a vysvětlení se do tmavého pruhu vedle
   * pěti dalších prvků nevejde. Místo nich stojí v pruhu jedna věta, která říká,
   * co v tomhle režimu jde a jak se dostat ke zbytku.
   */
  const wholeFilter = selection.mode === 'allMatching';

  const scope: BulkScope =
    selection.mode === 'allMatching'
      ? { mode: 'filter', filters }
      : { mode: 'ids', ids: [...selection.ids] };

  /**
   * Publikum exportu. U výběru je to výčet adres, u „vše odpovídající filtru" tentýž
   * filtr, jaký je v URL. Odmítnutí (hledaný výraz, přes tisíc adres) se nese dál
   * a dialog z něj napíše, co udělat místo toho.
   */
  const exportOutcome =
    selection.mode === 'allMatching'
      ? filtersToAudience(filters)
      : emailsToAudience(selectedEmails);

  async function addTag(tagId: string, tagName: string) {
    // Přidání štítku je vratné a bez vnějšího dopadu (5.6 části 6), proto se hlásí
    // oznámením s odpočtem a nabídkou vrácení, ne dialogem.
    const result = await bulkTagContactsAction({ workspaceId, scope, add: [tagId] });
    // Chyba se do téhle chvíle spolkla: kliknutí neudělalo nic a rozhraní o tom mlčelo.
    if (result.status === 'error') {
      toast.error(t('bulk.tagFailed', { detail: result.code }));
      return;
    }
    toast.undoable({
      message: t('bulk.tagAdded', { tag: tagName }),
      onUndo: () => {
        void bulkTagContactsAction({ workspaceId, scope, remove: [tagId] }).then((undone) => {
          if (undone.status === 'error') {
            toast.error(t('bulk.tagFailed', { detail: undone.code }));
            return;
          }
          router.refresh();
        });
      },
    });
    router.refresh();
    // Štítek je přidaný, výběr splnil svůj účel. Nabídka „Vrátit zpět" v oznámení
    // funguje dál: drží si vlastní rozsah akce, ne aktuální výběr v tabulce.
    onCompleted?.();
  }

  /**
   * Hromadné ODEBRÁNÍ štítku.
   *
   * Nález zadavatele ze 7. 8. 2026: „Když vyberu nějaké kontakty a dám přidat štítek,
   * tak už ho nejsem schopen hromadně u kontaktů zrušit." Server to uměl od začátku,
   * `POST /contacts/tags:bulk` bere `add` i `remove` a vrací `tagged` a `untagged`.
   * Rozhraní nabízelo jen přidání; `remove` se používalo jedině ve vrácení zpět, tedy
   * na místě, kam se uživatel sám nedostal.
   *
   * Potvrzuje se DIALOGEM, ne nabídkou vrácení. Proč zrovna tady, když přidání dialog
   * nemá, vysvětluje `RemoveTagDialog`.
   */
  async function removeTag(tagId: string, tagName: string) {
    setRemovingTag(true);
    const result = await bulkTagContactsAction({ workspaceId, scope, remove: [tagId] });
    setRemovingTag(false);
    if (result.status === 'error') {
      toast.error(t('bulk.tagFailed', { detail: result.code }));
      return;
    }
    toast.success(t('bulk.tagRemoved', { tag: tagName }));
    router.refresh();
    onCompleted?.();
  }

  /**
   * Hromadné přidání do seznamu.
   *
   * JEN NAD OZNAČENÝMI ŘÁDKY, ze stejného důvodu jako povýšení na potvrzené: přihlašovací
   * endpoint bere adresy, ne filtr. V režimu „vše odpovídající filtru" se proto nabídka
   * seznamů vůbec nekreslí a tahle funkce se do volání nedostane; pojistka na začátku
   * přesto zůstává, protože rozhodnutí o rozsahu přichází zvenčí.
   *
   * Není to optimistická akce s nabídkou vrácení jako štítek. Přihlášení do seznamu
   * mění to, komu se smí posílat, a u odhlášeného kontaktu odešle potvrzovací e-mail
   * ven ze systému. Vzít zpět se dá odhlášení, ne odeslaný e-mail, takže se hlásí
   * až SKUTEČNÝ výsledek od serveru.
   *
   * ODHLÁŠENÝ KONTAKT SE MEZI PŘÍJEMCE TIŠE NEVRÁTÍ. Akce úmyslně neposílá prohlášení
   * o doloženém souhlasu, takže ho stavový automat pošle přes `pending` s potvrzovacím
   * odkazem. Rozhraní to musí říct nahlas, jinak by uživatel viděl „přidáno" a čekal
   * příjemce, kteří v rozesílce nebudou.
   */
  async function addToList(targetId: string) {
    if (selection.mode !== 'ids') return;
    const list = lists.find((candidate) => candidate.id === targetId);
    if (list === undefined) return;

    setAddingToList(true);
    const result = await addContactsToListAction({
      workspaceId,
      listId: targetId,
      ids: [...selection.ids],
    });
    setAddingToList(false);

    if (result.status === 'error') {
      toast.error(t('bulk.addToListFailed', { detail: result.code }));
      return;
    }

    const { confirmed, pending, already, blocked } = result.summary;
    const message = t('bulk.addToListDone', {
      list: list.name,
      added: confirmed + pending,
      already,
    });
    const notes = [
      pending > 0 ? t('bulk.addToListPending', { count: pending }) : '',
      blocked > 0 ? t('bulk.addToListBlocked', { count: blocked }) : '',
    ]
      .filter((note) => note !== '')
      .join(' ');

    // Chybová barva u výsledku, kde se něco opravdu přidalo, je schválně: oznámení
    // chybové barvy se nezavírá samo a přeskočený kontakt je informace, kterou
    // uživatel přehlédnout nesmí.
    if (blocked > 0) toast.error(message, notes);
    else if (notes !== '') toast.success(message, notes);
    else toast.success(message);

    router.refresh();
    onCompleted?.();
  }

  /**
   * Hromadné odebrání ze seznamu, tedy odhlášení. Potvrzuje se dialogem, ne nabídkou
   * vrácení: proč, je vysvětlené u `RemoveFromListDialog`.
   *
   * Hlásí se stejně poctivě jako přidání: kolik se opravdu odhlásilo a u kolika nebylo
   * co měnit, protože v seznamu vůbec nebyli nebo v něm odhlášení už byli.
   */
  async function removeFromList() {
    if (listId === null || selection.mode !== 'ids') return;
    const list = lists.find((candidate) => candidate.id === listId);
    if (list === undefined) return;

    setRemovingFromList(true);
    const result = await removeContactsFromListAction({
      workspaceId,
      listId,
      ids: [...selection.ids],
    });
    setRemovingFromList(false);

    if (result.status === 'error') {
      toast.error(t('bulk.removeFromListFailed', { detail: result.code }));
      return;
    }

    const { unsubscribed, unchanged } = result.summary;
    const message = t('bulk.removeFromListDone', {
      list: list.name,
      unsubscribed,
      unchanged,
    });
    if (unchanged > 0) {
      toast.success(message, t('bulk.removeFromListNothing', { count: unchanged }));
    } else {
      toast.success(message);
    }

    router.refresh();
    onCompleted?.();
  }

  /**
   * Hromadné povýšení na potvrzené.
   *
   * JEN NAD OZNAČENÝMI ŘÁDKY, ne nad „vše odpovídající filtru": akce jde po jednom
   * kontaktu (hromadný endpoint na změnu stavu v API není) a nad statisíci řádky
   * by to byl statisíc požadavků. V režimu celého filtru se tlačítko nekreslí,
   * místo něj stojí v pruhu věta, proč tam není.
   *
   * Není to optimistická akce s nabídkou vrácení jako štítek: povýšení zapisuje
   * souhlas a potvrzuje přihlášení do seznamů, tedy má vnější dopad na to, komu
   * se smí posílat. Hlásí se proto až SKUTEČNÝ výsledek od serveru.
   *
   * ŽÁDNÝ KONTAKT SE UŽ NEPŘESKAKUJE. Dřív se odhlášený, odražený a stěžující si kontakt
   * počítal jako „beze změny", protože ho zápis mlčky nechal být. Server má dnes pro
   * výslovné rozhodnutí správce vlastní cestu, takže povýšení projde vždycky. Zůstala
   * jediná výhrada, a ta se hlásí zvlášť: u části kontaktů může na adrese ZŮSTAT blokace,
   * kterou sundat nesmíme (stížnost, trvalý odraz), a těm se pořád nic neodešle.
   */
  async function confirmSelected() {
    if (selection.mode !== 'ids') return;
    setConfirming(true);
    const result = await confirmContactsAction({ workspaceId, ids: [...selection.ids] });
    setConfirming(false);
    if (result.status === 'error') {
      toast.error(t('confirmState.failed', { detail: result.code }));
      return;
    }

    const blocked = result.outcomes.filter(
      (outcome) => outcome.suppressionBlocking !== null,
    ).length;

    if (blocked > 0) {
      // Chybová barva u výsledku, kde se stav opravdu změnil, je schválně: oznámení
      // chybové barvy se nezavírá samo, a tohle je informace, kterou uživatel přehlédnout
      // nesmí. Kontakty jsou potvrzené a přesto se jim neodešle.
      toast.error(
        t('confirmState.doneWithBlocked', { confirmed: result.outcomes.length, blocked }),
      );
    } else {
      toast.success(t('confirmState.done', { count: result.outcomes.length }));
    }
    router.refresh();
    // Chybová barva oznámení výš neznamená neúspěch: kontakty POVÝŠENÉ JSOU, jen na
    // části adres zůstala blokace. Akce doběhla, takže se výběr uklízí i v té větvi.
    onCompleted?.();
  }

  return (
    <>
      {/* Věta místo tří zašedlých ovládacích prvků. Stojí před akcemi, protože
          vysvětluje, proč je jich v tomhle režimu míň, ne co dělá to za ní. */}
      {wholeFilter ? (
        <span data-testid="bulk-whole-filter-note" className="text-panel-soft">
          {t('bulk.wholeFilterLimits')}
        </span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className={PANEL_BUTTON}
          disabled={confirming}
          onClick={() => {
            void confirmSelected();
          }}
        >
          <CircleCheckBig aria-hidden className="icon-sm" />
          {confirming ? t('confirmState.confirming') : t('confirmState.bulkAction')}
        </Button>
      )}

      {/*
       * ŠTÍTKY: JEDNA NABÍDKA NA PŘIDÁNÍ I ODEBRÁNÍ.
       *
       * Přidání tu bylo od začátku, odebrání nešlo vůbec, přestože ho server umí.
       * Obě akce jsou nad týmž seznamem štítků, takže je uživatel nemá hledat na dvou
       * místech; oddělují je nadpis skupiny, čára a barva, ne až text položky.
       *
       * `w-56` je tu proto, že lišta je flex se zalomením: spouštěč na celou šířku by
       * zabral celý řádek a vytlačil tlačítka pod sebe.
       */}
      {tags.length > 0 && !wholeFilter ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={PANEL_MENU} disabled={removingTag}>
              <span className="flex items-center gap-2">
                <Tag aria-hidden className="icon-sm" />
                {t('bulk.tagsMenu')}
              </span>
              <ChevronDown aria-hidden className="icon-sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-auto">
            <DropdownMenuGroup label={t('bulk.addTag')}>
              {tags.map((tag) => (
                <DropdownMenuItem
                  key={`add-${tag.id}`}
                  onSelect={() => void addTag(tag.id, tag.name)}
                >
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup label={t('bulk.removeTag')}>
              {tags.map((tag) => (
                <DropdownMenuItem
                  key={`remove-${tag.id}`}
                  tone="danger"
                  onSelect={() => {
                    setRemoveTagTarget(tag);
                    setRemoveTagOpen(true);
                  }}
                >
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/*
       * SEZNAMY: TÁŽ NABÍDKA, JEN S JINÝM OBSAHEM.
       *
       * Do 7. 8. 2026 tu stálo rozbalovátko s cílem a vedle něj dvě tlačítka s akcí,
       * takže byla nabídka bez tlačítka slepá a tlačítko bez nabídky nemělo cíl. Teď
       * nese obojí jedna nabídka a lišta je o dva prvky kratší.
       */}
      {lists.length > 0 && !wholeFilter ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={PANEL_MENU}
              disabled={addingToList || removingFromList}
            >
              <span className="flex items-center gap-2">
                <List aria-hidden className="icon-sm" />
                {addingToList
                  ? t('bulk.addToListRunning')
                  : removingFromList
                    ? t('bulk.removeFromListRunning')
                    : t('bulk.listsMenu')}
              </span>
              <ChevronDown aria-hidden className="icon-sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-auto">
            <DropdownMenuGroup label={t('bulk.addToListAction', { count: selection.count })}>
              {lists.map((list) => (
                <DropdownMenuItem key={`add-${list.id}`} onSelect={() => void addToList(list.id)}>
                  {list.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup label={t('bulk.removeFromListAction', { count: selection.count })}>
              {lists.map((list) => (
                <DropdownMenuItem
                  key={`remove-${list.id}`}
                  tone="danger"
                  onSelect={() => {
                    setListId(list.id);
                    setRemoveOpen(true);
                  }}
                >
                  {list.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Export výběru. Do 5. 8. 2026 se dal výběr vyvézt jedině z dialogu mazání,
          tedy jen tomu, kdo ho chtěl smazat, a i tam skončil na 422.

          VÝBĚR PO EXPORTU ZŮSTÁVÁ, a je to vědomé rozhodnutí. Export nic nezměnil:
          tytéž kontakty jsou pořád v tabulce a export je typicky mezikrok („vyveze
          si je a pak jim přidám štítek"). Zrušit výběr tady by znamenalo označovat
          znovu. U ostatních akcí je to obráceně: po nich už s výběrem není co dělat. */}
      <Button
        variant="secondary"
        size="sm"
        className={PANEL_BUTTON}
        onClick={() =>
          void contactExport.start({
            title: t('bulk.exportTitle'),
            fileName: t('list.exportFileName'),
            outcome: exportOutcome,
          })
        }
      >
        <Download aria-hidden className="icon-sm" />
        {t('bulk.export', { count: selection.count })}
      </Button>

      {/* Mazání si plnou barvu nechává: na tmavém pruhu je to jediná akce s vnějším
          dopadem, který nejde vzít zpět, a nesmí splynout s ostatními. */}
      <Button
        variant="destructive"
        size="sm"
        className="text-sm shadow-none hover:translate-y-0 hover:shadow-none"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 aria-hidden className="icon-sm" />
        {t('bulk.delete')}
      </Button>

      {/* Okno odebrání štítku. `key` zařídí, že okno otevřené nad jiným štítkem začíná
          čisté, stejně jako u oken v řádku tabulky. */}
      {removeTagTarget === null ? null : (
        <RemoveTagDialog
          key={removeTagTarget.id}
          open={removeTagOpen}
          onOpenChange={setRemoveTagOpen}
          count={selection.count}
          tagName={removeTagTarget.name}
          onConfirm={() => removeTag(removeTagTarget.id, removeTagTarget.name)}
        />
      )}

      <RemoveFromListDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        count={selection.count}
        listName={lists.find((candidate) => candidate.id === listId)?.name ?? ''}
        // Kolik označených kontaktů po odhlášení nezůstane v žádném seznamu. Počítá se
        // z toho, co je na obrazovce, ne dalším dotazem na server; podrobně u propy.
        orphaned={
          listId === null
            ? 0
            : selectedSubscriptions.filter((ids) => ids.length === 1 && ids[0] === listId).length
        }
        onConfirm={removeFromList}
      />

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />

      <BulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        selection={selection}
        filterDescription={filterDescription}
        // Dialog o výsledku informuje sám („Soubor je stažený. Teď můžete kontakty
        // smazat."), takže se tu nepoužívá dialog s tlačítkem: druhé okno nad dialogem
        // mazání by jen překáželo. Slib „stažený" je od téhle chvíle pravdivý.
        onExport={() =>
          exportAndDownload({
            workspaceId,
            locale,
            outcome: exportOutcome,
            fileName: t('list.exportFileName'),
          })
        }
        onConfirm={async () => {
          const result = await bulkDeleteContactsAction({ workspaceId, scope });
          if (result.status === 'success') {
            // Hromadné smazání běží v jobu contacts.bulk_delete, takže se nehlásí „hotovo",
            // ale „mažeme". Lhát o dokončení by znamenalo, že uživatel obnoví stránku
            // a uvidí kontakty, které podle hlášky už neexistují.
            toast.success(t('bulk.queued', { count: selection.count }));
            router.refresh();
            // Nejdůležitější místo z celého nálezu: po smazání ležely ve výběru
            // identifikátory kontaktů, které už neexistují, a pruh nad tabulkou nad
            // nimi dál nabízel akce.
            onCompleted?.();
          } else {
            // Dialog se zavírá i po chybě, takže bez tohohle oznámení zůstal uživatel
            // u nezměněné tabulky a bez jediného slova o tom, že se mazání nespustilo.
            toast.error(t('bulk.deleteFailed', { detail: result.code }));
          }
          return result;
        }}
      />
    </>
  );
}
