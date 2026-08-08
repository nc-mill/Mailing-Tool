'use client';

import { Badge } from '@mlain/ui/components/badge';
import { Card } from '@mlain/ui/components/card';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { cn } from '@mlain/ui/lib/cn';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { WORKER_STATUS_REFRESH_MS } from './refresh';
import {
  WORKER_STATE_KEYS,
  cronQueuesWithoutHandler,
  stuckQueues,
  workerNeedsAttention,
  workerStateTone,
  type ApiWorkerStatus,
  type WorkerStatusResponse,
} from './worker-status-view';

export type WorkerStatusPanelProps = {
  /** Stav načtený serverem při otevření stránky. Klient ho jen udržuje čerstvý. */
  initialWorker: ApiWorkerStatus | null;
  workspaceId: string;
};

/**
 * PANEL „ZPRACOVÁNÍ NA POZADÍ" NAD SEZNAMEM ÚLOH.
 *
 * PROČ VZNIKL, doslova podle dvou vět ze skutečného provozu: „potřebuju vidět,
 * kolik úloh je ve frontě, jestli worker běží, nebo je zaseknutý" a „worker měl
 * ve frontě desítky úloh, ale na stránce visely jen dvě". Obojí je jeden
 * problém: Centrum úloh do teď ukazovalo POUZE dva doménové zdroje (import
 * kontaktů, stavbu publika kampaně) a o zbytku práce workeru nevědělo nic.
 * Naměřeno 7. 8. za třicet minut: 188 úloh `__pgboss__send-it`, po 25 ticích
 * čtyř cronových front, k tomu 8 selhaných běhů `outbox.reconcile`. Na
 * obrazovce z toho nebylo vidět nic.
 *
 * PROČ TO NENÍ ROZPIS PO FRONTÁCH, ale čtyři čísla. Cronové fronty jsou práce
 * INSTALACE, ne jednoho projektu: `outbox.stall_watch` ani
 * `tracking.refresh_campaign_progress` majiteli projektu nic neříkají a jejich
 * tik každou minutu by ze seznamu jeho vlastních úloh udělal nečitelný proud.
 * Rozpis po frontách navíc nemá na téhle obrazovce publikum: kdo umí přečíst
 * název fronty, dívá se do logu workeru nebo pouští `mlain doctor`. Zůstávají
 * proto souhrny, které odpovídají na otázku, kterou uživatel doopravdy má:
 * mám čekat, nebo volat správce.
 *
 * PROČ SE PANEL OBNOVUJE, I KDYŽ NIC NEBĚŽÍ, je vysvětlené u konstanty
 * `WORKER_STATUS_REFRESH_MS`. Zkráceně: zaseknutý worker se pozná právě
 * v okamžiku, kdy neběží nic.
 */
export function WorkerStatusPanel({ initialWorker, workspaceId }: WorkerStatusPanelProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const [worker, setWorker] = useState<ApiWorkerStatus | null>(initialWorker);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/jobs/worker', {
        headers: { 'X-Workspace-Id': workspaceId, accept: 'application/json' },
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as WorkerStatusResponse;
      if (!body.worker) throw new Error('odpověď bez stavu workeru');
      setWorker(body.worker);
    } catch {
      // Neúspěch panel NEMAŽE a nepřepíná ho na „neběží". Nedostupné API je
      // vada webu, ne workeru, a tvrdit v tu chvíli, že zpracování stojí,
      // by poslalo člověka hledat na nesprávné místo. Zůstane poslední
      // změřený stav a další tik ho dorovná.
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, WORKER_STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Server stav nenačetl (výpadek, chybějící oprávnění). Panel se v tu chvíli
  // nekreslí vůbec: prázdná karta s pomlčkami tvrdí, že se měřilo a nic nevyšlo.
  if (!worker) return null;

  const attention = workerNeedsAttention(worker);
  const withoutHandler = cronQueuesWithoutHandler(worker);
  const stuck = stuckQueues(worker);

  return (
    <Card padding="md" tone={attention ? 'highlight' : 'plain'} aria-labelledby="worker-status">
      <div className="flex flex-wrap items-center justify-between gap-[var(--spacing-inline)]">
        <h2 id="worker-status" className="meta-caps text-text-muted">
          {t('jobs.workerTitle')}
        </h2>
        {/* Stav se sděluje SLOVEM v odznaku, barva je jen podpora (pravidlo 11.3). */}
        <Badge tone={workerStateTone(worker.state)}>{t(WORKER_STATE_KEYS[worker.state])}</Badge>
      </div>

      <p className="text-meta text-text-muted">
        {worker.last_seen_at
          ? t('jobs.workerLastSeen', {
              time: format.dateTime(new Date(worker.last_seen_at), 'time'),
            })
          : t('jobs.workerNeverSeen')}
      </p>

      <dl className="grid grid-cols-2 gap-[var(--spacing-inline)] sm:grid-cols-4">
        <WorkerCount label={t('jobs.workerWaiting')} value={worker.queue.waiting} />
        <WorkerCount label={t('jobs.workerActive')} value={worker.queue.running} />
        <WorkerCount
          label={t('jobs.workerFailed', { hours: worker.queue.failed_window_hours })}
          value={worker.queue.failed_recent}
        />
        {/*
          Dead letter je JEDINÉ číslo, které se zvýrazňuje, i když je malé.
          Úloha v něm se sama nikdy nezpracuje: vyčerpala všechny pokusy a leží
          stranou, dokud si jí nevšimne člověk. Jednička tady váží víc než
          stovka selhání, která se za minutu zopakují úspěšně.
        */}
        <WorkerCount
          label={t('jobs.workerDeadLetter')}
          value={worker.queue.dead_letter}
          alert={worker.queue.dead_letter > 0}
        />
      </dl>

      {/*
        VÝKLAD JE SBALENÝ, ČÍSLA ZŮSTÁVAJÍ VIDĚT.

        Ty čtyři číslice nad tímhle jsou to, na co se člověk kouká pokaždé.
        Zbytek, tedy vysvětlení okna selhání, počty front a rozpis pádů, jsou
        odpovědi na otázku, kterou si položí až ve chvíli, kdy mu některé číslo
        nesedí. Vyvěšené natrvalo z nich byl odstavec, který nikdo nečte, a
        panel kvůli němu zabíral polovinu obrazovky nad vlastním seznamem úloh.

        Sbalený stav je výchozí SCHVÁLNĚ i tehdy, když něco leží odložené
        stranou: číslo „Odloženo stranou" je zvýrazněné samo o sobě a shrnutí
        v hlavičce řekne, kolik toho je, takže se poplach neschová.
      */}
      <Collapsible
        summary={
          <span className="text-meta">
            {t('jobs.workerDetails', {
              failures: worker.queue.failures.length,
              parked: worker.queue.dead_letter,
            })}
          </span>
        }
      >
        <div className="flex flex-col gap-[var(--spacing-stack)]">
          <p className="text-meta text-text-muted">
            {t('jobs.workerFailedNote', { hours: worker.queue.failed_window_hours })}
          </p>

          <p className="text-meta text-text-muted">
            {t('jobs.workerQueues', {
              registered: worker.queues.registered,
              scheduled: worker.queues.cron_scheduled,
              expected: worker.queues.cron_expected,
            })}
            {withoutHandler > 0
              ? ` ${t('jobs.workerCronWithoutHandler', { count: withoutHandler })}`
              : ''}
          </p>

          {/*
        ROZPIS PÁDŮ. Bez něj je číslo „selhalo za 24 h" poplach bez odpovědi.
        Zadavatel to 8. 8. 2026 popsal takhle: „uživatel bude zmatený co
        selhalo, jestli to proběhlo znovu nebo jestli něco nebylo doručeno".
        Panel proto u každé fronty říká, co dělá a jestli od pádu znovu
        proběhla. Naměřeno tentýž den: všech 28 pádů bylo z uzavřených epizod
        a všechny fronty se zotavily, přesto panel psal „Něco se nezpracovává
        samo".
      */}
          {worker.queue.failures.length > 0 ? (
            <section aria-labelledby="worker-failures" className="flex flex-col gap-1">
              <h3 id="worker-failures" className="meta-caps text-text-muted">
                {t('jobs.workerFailuresTitle')}
              </h3>
              <p className="text-meta text-text">
                {stuck.length === 0
                  ? t('jobs.workerFailuresAllRecovered')
                  : t('jobs.workerFailuresStuck', { queues: stuck.map((f) => f.queue).join(', ') })}
              </p>
              <ul className="flex flex-col gap-1">
                {worker.queue.failures.map((failure) => (
                  <li key={failure.queue} className="text-meta text-text-muted">
                    <span className="font-mono break-all text-text">{failure.queue}</span>
                    {failure.description ? ` ${failure.description}` : ''}{' '}
                    <span className={failure.recovered ? undefined : 'text-danger-text'}>
                      {t(
                        failure.recovered
                          ? 'jobs.workerFailureRecovered'
                          : 'jobs.workerFailureStuck',
                        {
                          count: failure.failures,
                          time:
                            failure.recovered && failure.last_success_at
                              ? format.dateTime(new Date(failure.last_success_at), 'time')
                              : failure.last_failure_at
                                ? format.dateTime(new Date(failure.last_failure_at), 'time')
                                : '',
                        },
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/*
        CO ZŮSTALO NEDOKONČENÉ. Tohle je odpověď na „nebylo něco doručeno" a je
        to JINÁ otázka než ta výš: zotavená fronta znamená, že mechanismus jede
        dál, ne že se dokončila právě ta úloha, která spadla. Ta leží tady.
        Dokud tenhle výpis nebyl, ukazoval panel jen počet a radil zavolat
        správce instalace, který ale neměl kam se podívat.
      */}
          {worker.queue.dead_letter > 0 ? (
            <section aria-labelledby="worker-dead-letter" className="flex flex-col gap-1">
              <h3 id="worker-dead-letter" className="meta-caps text-text-muted">
                {t('jobs.workerDeadLetterTitle')}
              </h3>
              <p className="text-ui text-text">{t('jobs.workerDeadLetterExplain')}</p>
              <ul className="flex flex-col gap-1">
                {worker.queue.dead_letter_items.map((deadItem, index) => (
                  <li key={`${deadItem.queue}-${index}`} className="text-meta text-text-muted">
                    <span className="font-mono break-all text-text">{deadItem.queue}</span>
                    {deadItem.at ? ` ${format.dateTime(new Date(deadItem.at), 'time')}` : ''}:{' '}
                    {deadItem.reason}
                  </li>
                ))}
              </ul>
              {worker.queue.dead_letter > worker.queue.dead_letter_items.length ? (
                <p className="text-meta text-text-muted">
                  {t('jobs.workerDeadLetterMore', {
                    count: worker.queue.dead_letter - worker.queue.dead_letter_items.length,
                  })}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </Collapsible>
    </Card>
  );
}

/**
 * Jedno číslo panelu. Není to `StatTile` z přehledu: ta nese ikonu, patičku
 * a deltu, tedy tři věci, které tady nemají co říct, a je to schválně lokální
 * prvek jedné obrazovky, ne prvek katalogu (zdůvodnění je v jejím souboru).
 */
function WorkerCount({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="meta-caps text-text-muted">{label}</dt>
      <dd
        className={cn(
          'text-title font-semibold leading-[var(--leading-number)]',
          'tracking-[var(--tracking-number)]',
          alert ? 'text-danger-text' : 'text-text',
        )}
      >
        {format.number(value)}
      </dd>
    </div>
  );
}
