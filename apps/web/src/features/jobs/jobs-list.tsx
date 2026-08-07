'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
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
import { RefreshCw } from '@mlain/ui/icons';
import { useRouter } from '@mlain/i18n/navigation';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { RUNNING_STATUSES } from '@mlain/ui/patterns/jobs';
import { EmptyState, StaleBanner } from '@mlain/ui/patterns/states';
import { useContactsTableLabels } from '@/features/contacts/table-labels';
import { MoreIcon } from '@/lib/ui/status-icons';
import { JobCancelDialog, useCancelResultMessage } from './cancel-job-button';
import {
  jobDetailHref,
  jobKey,
  jobKindKey,
  jobNote,
  jobSourceLink,
  jobStatusKey,
  jobStatusTone,
  mergeJobs,
  replaceFirstPage,
  type ApiJob,
  type JobsResponse,
} from './job-view';
import { JOBS_LIST_REFRESH_MS, JOBS_PAGE_LIMIT } from './refresh';
import { WorkerStatusPanel } from './worker-status-panel';
import type { ApiWorkerStatus } from './worker-status-view';

export type JobsListProps = {
  /** Úlohy načtené serverem při otevření stránky. Klient je jen udržuje čerstvé. */
  initialJobs: ApiJob[];
  /** Kurzor na další stránku z prvního načtení, nebo `null`, když další není. */
  initialNextBefore: string | null;
  /** Kolik úloh má projekt celkem. Patička tabulky bez toho píše „50 z 50". */
  initialTotal: number;
  /** Stav workeru z prvního načtení. `null`, když se nepodařilo změřit. */
  initialWorker: ApiWorkerStatus | null;
  workspaceId: string;
  workspaceSlug: string;
};

/**
 * SEZNAM ÚLOH JE TABULKA, ne karty, a od 7. 8. je to `DataTable` z návrhového
 * systému.
 *
 * PROČ SE TO ZMĚNILO. Do té doby kreslil seznam `JobsCenter`, vlastní prvek
 * návrhového systému, kde každá úloha byla karta na čtyři řádky (název, čas
 * dokončení, kdo spustil, dva odkazy). Tři úlohy zabraly celou obrazovku
 * a deset úloh se nedalo přehlédnout. Zadavatel to viděl a chtěl tabulku
 * „jako ostatní tabulky", což je zároveň to podstatné: aplikace kreslí seznamy
 * `DataTable` na sedmi obrazovkách a druhý způsob, jak vypadá seznam, byl
 * odchylka, ne funkce. `JobsCenter` proto zanikl celý, včetně deseti popisků,
 * které obsluhoval.
 *
 * CO SE TÍM ZTRATILO A PROČ TO NEVADÍ. Karty byly rozdělené na „Rozdělané"
 * a „Dokončené". Tabulka sekce nemá a mít nemá: řadí se podle poslední změny
 * sestupně, takže běžící úloha je vždycky nahoře, a od dokončené ji odliší
 * sloupec Stav. Dvě sekce nad tabulkou by znamenaly dvě tabulky s dvěma
 * patičkami a stránkovat by šlo jen jednu z nich.
 *
 * ŘÁDKOVÉ AKCE JSOU V NABÍDCE POD TŘEMI TEČKAMI, ne jako odkazy v řádku. Je to
 * týž tvar, jaký uživatel zná z kontaktů, seznamů a vlastních polí, takže se
 * nezavádí čtvrtý způsob řádkových akcí. Spouštěč je `IconButton` velikosti
 * `row`, tedy 34px čtverec s neviditelným 44px překryvem, aby se rytmus řádku
 * nezměnil a pravidlo klikací plochy přesto platilo.
 *
 * PRVNÍ SEZNAM CHODÍ ZE SERVERU, ne z prohlížeče. Stránka se stejně vykresluje
 * na serveru a jedno volání navíc v jejím rámci je levnější než prázdná
 * obrazovka, která se po hydrataci doplní.
 */
export function JobsList({
  initialJobs,
  initialNextBefore,
  initialTotal,
  initialWorker,
  workspaceId,
  workspaceSlug,
}: JobsListProps) {
  const t = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();

  const [jobs, setJobs] = useState<ApiJob[]>(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * ZÁSOBNÍK KURZORŮ, ne jedno „načíst další".
   *
   * `DataTable` stránkuje dopředu i dozadu (dvě šipky v patičce), kdežto
   * kurzor `before` umí jen dopředu. Cesta zpátky se proto pamatuje: každý
   * prvek je kurzor, kterým se načetla stránka na jeho indexu, a `null` je
   * první stránka. Bez toho by šipka zpátky musela být trvale zašedlá, což je
   * v tomhle projektu vada, ne vlastnost.
   */
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  /** Kurzor na stránku ZA tou zobrazenou. `null` znamená, že další není. */
  const [nextBefore, setNextBefore] = useState<string | null>(initialNextBefore);
  /**
   * Věta o výsledku zastavení. Je JEDNA pro celý seznam, ne u každého řádku:
   * do řádku by se nevešla a jako živá oblast by jich obrazovka měla dvacet.
   */
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  /**
   * Úloha, kterou se právě potvrzuje zastavení. Okno drží TABULKA, ne řádek:
   * obsah rozbalené nabídky se při volbě položky odpojí z DOM a odnesl by okno
   * s sebou dřív, než by se ukázalo.
   */
  const [cancelling, setCancelling] = useState<ApiJob | null>(null);
  /**
   * Výběr řádků. `DataTable` kreslí zaškrtávátka VŽDYCKY a vypnout se nedají.
   * U úloh není jediná hromadná akce (zastavit jde jen to, co jde zastavit,
   * a u každého druhu jinak), takže tenhle výběr NIKAM NEVEDE. Je to nález
   * napříč aplikací, ne vada téhle obrazovky, a je zapsaný v `STAV-UKOLU.md`;
   * `selectable={false}` v návrhovém systému zatím není.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  /**
   * Čas posledního načtení. Startuje NULL, ne `new Date()`: server a klient
   * by se v tu chvíli lišily o pár set milisekund a React by hlásil nesoulad
   * hydratace. Čas se objeví až po prvním obnovení v prohlížeči.
   */
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const cancelResultMessage = useCancelResultMessage();

  const tableLabels = useContactsTableLabels({
    selectRow: t('jobs.title'),
    selectAllOnPage: t('jobs.title'),
    // Pruh výběru nesmí nad úlohami mluvit o kontaktech.
    selectionWording: 'generic',
  });

  /** Jedno načtení stránky. Vrací tělo, ať si s ním volající naloží po svém. */
  const fetchPage = useCallback(
    async (before: string | null): Promise<JobsResponse> => {
      const query = new URLSearchParams({ limit: String(JOBS_PAGE_LIMIT) });
      if (before !== null) query.set('before', before);
      const response = await fetch(`/api/v1/jobs?${query.toString()}`, {
        headers: { 'X-Workspace-Id': workspaceId, accept: 'application/json' },
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as JobsResponse;
      // Odpověď, která nemá seznam, je pro obrazovku totéž co výpadek. Bez
      // téhle kontroly se `undefined` dostane do stavu a seznam spadne až
      // při dalším vykreslení, tedy daleko od místa, kde vada vznikla.
      if (!Array.isArray(body.data)) throw new Error('odpověď bez seznamu úloh');
      return body;
    },
    [workspaceId],
  );

  /**
   * OBNOVENÍ NAČÍTÁ TU STRÁNKU, NA KTERÉ ČLOVĚK STOJÍ, ne vždycky první.
   *
   * Na první stránce se navíc čerstvý obsah slévá tak, aby z ní zmizelo, co
   * tam server už nemá (`replaceFirstPage`). Na dalších stránkách se prostě
   * nahradí: dolistovaná stránka žádnou historii pod sebou nedrží.
   */
  const load = useCallback(async () => {
    setPending(true);
    try {
      const before = cursors[pageIndex] ?? null;
      const body = await fetchPage(before);
      const hasMore = (body.next_before ?? null) !== null;
      setJobs((previous) =>
        before === null ? replaceFirstPage(previous, body.data, hasMore) : body.data,
      );
      setNextBefore(body.next_before ?? null);
      setTotal(body.total ?? 0);
      setRefreshedAt(new Date());
      setFailed(false);
    } catch {
      // Neúspěch seznam NEMAŽE. Poslední známý stav je pořád užitečnější než
      // prázdná obrazovka, jen se nad ním přizná, že je starý.
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [cursors, fetchPage, pageIndex]);

  const goToPage = useCallback(
    async (index: number, before: string | null) => {
      setPending(true);
      try {
        const body = await fetchPage(before);
        setJobs(mergeJobs([], body.data));
        setNextBefore(body.next_before ?? null);
        setTotal(body.total ?? 0);
        setCursors((previous) => {
          const next = previous.slice(0, index);
          next[index] = before;
          return next;
        });
        setPageIndex(index);
        setSelectedIds([]);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setPending(false);
      }
    },
    [fetchPage],
  );

  /**
   * Obnovuje se, jen dokud se čísla MŮŽOU hýbat.
   *
   * `RUNNING_STATUSES` je tu schválně, ne `UNFINISHED_STATUSES`: u pozastavené
   * úlohy se čeká na člověka, takže by časovač tikal donekonečna a pokaždé
   * přinesl tatáž čísla. Import čekající na potvrzení mapování se pohne až
   * kliknutím, a to obrazovku překreslí samo.
   *
   * Druhá podmínka je kvůli úloze, která se ZASTAVUJE. Ta má stav `cancelled`,
   * tedy koncový, ale rozepsaná dávka pořád zapisuje a čísla se hýbou; bez ní
   * by seznam zamrzl na hodnotách z okamžiku kliknutí.
   */
  const anyRunning = jobs.some((job) => RUNNING_STATUSES.includes(job.status) || job.stopping);

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, JOBS_LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  /*
   * Poznámka řádku NEOPAKUJE, co už říká odznak. Odznak u zastavované úlohy
   * hlásí „Zastavuje se", takže věta z detailu („Zastavuje se: rozpracovaná
   * dávka ještě doběhne…") by na řádku stála podruhé a zabrala půl sloupce.
   * Zůstává z ní jen to, co odznak neříká.
   */
  const noteLabels = {
    failureCode: (code: string) => t('jobs.failureCode', { code }),
    stopping: t('jobs.stoppingRowNote'),
  };

  return (
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      <PageHeader
        title={t('jobs.title')}
        description={t('jobs.description')}
        actions={
          <Button variant="secondary" onClick={() => void load()} pending={pending}>
            <RefreshCw aria-hidden className="icon-sm" />
            {t('actions.refresh')}
          </Button>
        }
      />

      {/*
        Panel jde NAD tabulku, ne pod ni. Odpovídá na otázku, se kterou sem
        člověk přišel („běží to vůbec?"), a když je odpověď „ne", nemá smysl,
        aby ji hledal pod padesáti řádky historie.
      */}
      <WorkerStatusPanel initialWorker={initialWorker} workspaceId={workspaceId} />

      {failed ? (
        <StaleBanner
          lastUpdatedLabel={t('jobs.refreshFailed')}
          retryAction={
            <Button variant="secondary" size="sm" onClick={() => void load()} pending={pending}>
              {t('actions.tryAgain')}
            </Button>
          }
        />
      ) : null}

      {/* Živá oblast, ne jen odstavec: po kliknutí na zastavení se nic jiného
          na obrazovce nezmění, takže bez `aria-live` by odečítač mlčel. */}
      <p role="status" aria-live="polite" className="text-ui text-text">
        {cancelMessage}
      </p>

      <p className="text-meta text-text-muted">
        {t('jobs.refreshHint')}
        {refreshedAt
          ? ` ${t('jobs.refreshedAt', { time: format.dateTime(refreshedAt, 'time') })}`
          : ''}
      </p>

      <DataTable<ApiJob>
        tableId="jobs"
        caption={t('jobs.title')}
        rows={jobs}
        getRowId={jobKey}
        labels={tableLabels}
        count={{ value: total, precision: 'exact' }}
        /*
         * BEZ VÝBĚRU. Hromadná akce nad úlohami vzniknout NEMŮŽE: zastavit jde
         * jen to, co jde zastavit, a u každého druhu úlohy něčím jiným. Výběr by
         * tedy sliboval dávkovou operaci, která ani dávat smysl nemůže.
         */
        selectable={false}
        /*
         * Sedm sloupců, ne šest. Výchozí šestka `DataTable` by schovala ten
         * poslední, a poslední je nabídka akcí: obrazovka by přišla o jedinou
         * cestu k zastavení úlohy, aniž by o to kdo požádal.
         */
        defaultVisibleColumns={7}
        pagination={{
          hasMore: nextBefore !== null,
          canGoBack: pageIndex > 0,
          onPrevious: () => void goToPage(pageIndex - 1, cursors[pageIndex - 1] ?? null),
          onNext: () => void goToPage(pageIndex + 1, nextBefore),
        }}
        selection={{ selectedIds, onSelectionChange: setSelectedIds }}
        onRowActivate={(job) => router.push(jobDetailHref(job, workspaceSlug))}
        emptyState={
          <EmptyState
            variant="first"
            title={t('jobs.title')}
            explanation={t('jobs.empty')}
            /*
             * Prázdné Centrum úloh NEMÁ akci, a je to správně: úlohu tady
             * nikdo nespouští, spouští se importem kontaktů nebo odesláním
             * kampaně. Tlačítko „Založit úlohu" by slibovalo cestu, která
             * odsud nevede.
             */
            actions={[]}
          />
        }
        columns={[
          {
            id: 'title',
            header: t('jobs.columnTitle'),
            // Hlavní údaj úlohy je NÁZEV, tedy jméno souboru nebo kampaně,
            // ne stav. Podle něj člověk pozná svůj import mezi ostatními.
            mobile: 'primary',
            cell: (job) => <span className="truncate font-medium text-text">{job.title}</span>,
          },
          {
            id: 'kind',
            header: t('jobs.columnKind'),
            width: 190,
            // Na kartě se druh nekreslí: název souboru i jméno kampaně samy
            // říkají dost a čtyři údaje na 390 px se nepřečtou.
            mobile: 'hidden',
            cell: (job) => <span className="text-text-muted">{t(jobKindKey(job.kind))}</span>,
          },
          {
            id: 'status',
            header: t('jobs.statusLabel'),
            width: 210,
            mobile: 'secondary',
            cell: (job) => {
              const note = jobNote(job, noteLabels);
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={jobStatusTone(job.status)}>{t(jobStatusKey(job))}</Badge>
                  {/*
                    Poznámka zůstává NA ŘÁDKU, ne pod ním: „co záznam, to jeden
                    řádek". Delší věta se ořízne a celá je v `title`, protože
                    kód selhání se hodí přečíst, ale nesmí rozhodit rytmus.
                  */}
                  {note ? (
                    <span className="truncate text-meta text-text-muted" title={note}>
                      {note}
                    </span>
                  ) : null}
                </span>
              );
            },
          },
          {
            id: 'progress',
            header: t('jobs.progressLabel'),
            width: 140,
            mobile: 'secondary',
            cell: (job) => (
              <span className="font-mono text-meta text-text-muted">
                {job.total > 0
                  ? t('jobs.progressOf', {
                      done: format.number(job.done),
                      total: format.number(job.total),
                    })
                  : format.number(job.done)}
              </span>
            ),
          },
          {
            id: 'startedBy',
            header: t('jobs.startedByLabel'),
            width: 170,
            mobile: 'hidden',
            cell: (job) => (
              <span className="truncate text-text-muted">
                {job.started_by ?? t('jobs.startedBySystem')}
              </span>
            ),
          },
          {
            id: 'updatedAt',
            header: t('jobs.updatedAtLabel'),
            width: 170,
            mobile: 'secondary',
            cell: (job) => (
              <span className="font-mono text-meta text-text-muted">
                {format.dateTime(new Date(job.updated_at), 'dateTime')}
              </span>
            ),
          },
          {
            id: 'actions',
            header: t('jobs.columnActions'),
            width: 64,
            cell: (job) => (
              <JobRowMenu
                job={job}
                workspaceSlug={workspaceSlug}
                onDetail={() => router.push(jobDetailHref(job, workspaceSlug))}
                onSource={(href) => router.push(href)}
                onCancel={() => setCancelling(job)}
              />
            ),
          },
        ]}
      />

      {/*
        Okno drží tabulka, ne řádek. Zdůvodnění je u `JobCancelDialog`:
        rozbalená nabídka se při volbě položky odpojí z DOM i s oknem.
      */}
      {cancelling ? (
        <JobCancelDialog
          job={cancelling}
          workspaceId={workspaceId}
          open
          onOpenChange={(open) => {
            if (!open) setCancelling(null);
          }}
          onResult={(result) => {
            setCancelMessage(cancelResultMessage(result));
            setCancelling(null);
            // Načtení hned po zásahu, ať řádek ukáže skutečný stav
            // a ne ten, se kterým se na obrazovku přišlo.
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Nabídka akcí řádku. Tvar je opsaný ze seznamů (`lists-table.tsx`), aby
 * v produktu nevznikl čtvrtý způsob řádkových akcí: `IconButton` velikosti
 * `row` se třemi tečkami, jméno akce viditelným textem v položce, destruktivní
 * volba za oddělovačem a v červené.
 *
 * Zastavení se nabízí, JEN KDYŽ JDE. Rozhoduje `can_cancel` z API, protože
 * jedině zdroj úlohy ví, jestli má běh kam přepnout stav; zašedlá položka bez
 * vysvětlení je v tomhle projektu vada, takže třetí možnost není.
 */
function JobRowMenu({
  job,
  workspaceSlug,
  onDetail,
  onSource,
  onCancel,
}: {
  job: ApiJob;
  workspaceSlug: string;
  onDetail: () => void;
  onSource: (href: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('common');
  const source = jobSourceLink(job, workspaceSlug);
  const isCampaign = job.kind === 'campaign_audience';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('jobs.rowMenu', { name: job.title })}
          data-testid={`job-row-menu-${job.id}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů
           * a seznamů. Tlačítko o straně 44 px by řádek natáhlo a rozešlo by
           * se s rytmem ostatních tabulek; plochu proto roztahuje neviditelný
           * překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDetail}>{t('jobs.open')}</DropdownMenuItem>
        {source ? (
          <DropdownMenuItem onSelect={() => onSource(source.href)}>
            {t(source.labelKey)}
          </DropdownMenuItem>
        ) : null}
        {job.can_cancel ? (
          <Fragment>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={onCancel}>
              {t(isCampaign ? 'jobs.cancelCampaign' : 'jobs.cancelImport')}
            </DropdownMenuItem>
          </Fragment>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
