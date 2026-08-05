'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@mlain/i18n/navigation';
import { ProgressScreen, type CampaignProgress } from './progress-screen';
import {
  cancelCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  sendCampaignNowAction,
  undoCampaignAction,
} from './actions';

/**
 * Jak často se běžící kampaň obnovuje, podle toho, jak dlouho se na ni koukáme.
 *
 * Pevných pět sekund bylo špatně na obou koncích. Kampaň na tři adresy doběhne
 * dřív, než přijde první obnovení, takže se ukazatel nehnul ani jednou; kampaň
 * na sto tisíc adres se naopak ptá serveru osmnáctkrát za minutu i hodinu poté,
 * co je zajímavé už jen to, jestli je hotovo.
 *
 * Interval se proto prodlužuje. Rychlý začátek je tam, kde se doopravdy něco
 * děje (rozjezd, malá kampaň), a dlouhý běh se ptá řídce. Číslo počítá funkce,
 * ne komponenta, aby se dalo ověřit testem bez časovačů.
 */
export function refreshDelayMs(watchedMs: number): number {
  if (watchedMs < 30_000) return 2_000;
  if (watchedMs < 5 * 60_000) return 5_000;
  return 15_000;
}

/**
 * Klientský obal průběhu.
 *
 * Obnovuje se přes `router.refresh()`, tedy načtením serverové komponenty, ne
 * dopočtem v prohlížeči; čísla tak vždycky pocházejí z jednoho zdroje a ukazatel
 * nikdy nepředstírá postup, který se nestal. Serverová cesta `GET
 * /campaigns/{id}/progress` čte `messages` a `message_events` živě, takže se
 * pohne hned, jak odejde první zpráva, a ne až po tiku hlídače.
 *
 * Proč obnovování a ne událostní proud: průběh je několik celých čísel, která
 * se dají kdykoli dopočítat z databáze. Proud událostí (SSE) by k tomu potřeboval
 * vlastní koncový bod, držel by otevřené spojení na každou otevřenou obrazovku
 * a po výpadku by se stejně musel doptat na aktuální stav. U kampaně, kterou
 * uživatel sleduje jednotky minut, je to náklad bez užitku. Odhad podle počtu
 * příjemců nepřipadá v úvahu vůbec: to je přesně ten falešný pohyb, který
 * ukazatel dělat nesmí.
 */
export function ProgressView({
  progress,
  workspaceId,
  basePath,
}: {
  progress: CampaignProgress;
  workspaceId: string;
  basePath: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [releasing, setReleasing] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const live = progress.status === 'sending' || progress.status === 'queueing';

  /** Od kdy se na tuhle obrazovku koukáme. Řídí prodlužování intervalu. */
  const watchingSince = useRef(Date.now());

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, refreshDelayMs(Date.now() - watchingSince.current));
    };

    const tick = () => {
      if (stopped) return;
      // Skrytá karta se neobnovuje. Kampaň, kterou nikdo nesleduje, nemá důvod
      // vytěžovat server, a při návratu na kartu se stejně obnoví hned.
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        router.refresh();
      }
      schedule();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    schedule();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [live, router]);

  /*
   * Jakmile server přestane hlásit okno na zrušení, je „spouštíme" po pravdě
   * pryč, ať už proto, že akce prošla, nebo že okno doběhlo samo. Bez tohohle
   * by hláška o spouštění zůstala viset i po tom, co se kampaň rozjela.
   */
  useEffect(() => {
    if (progress.undo_remaining_seconds === 0) setReleasing(false);
  }, [progress.undo_remaining_seconds]);

  const run = useCallback(
    (
      action: (input: { workspaceId: string; campaignId: string }) => Promise<{ status: string }>,
    ) => {
      setActionFailed(false);
      startTransition(async () => {
        const result = await action({ workspaceId, campaignId: progress.campaign_id });
        if (result.status === 'error') {
          setActionFailed(true);
          setReleasing(false);
        }
        router.refresh();
      });
    },
    [progress.campaign_id, router, workspaceId],
  );

  /*
   * „Odeslat teď" se navenek projeví OKAMŽITĚ, ještě než odpoví server. Bez toho
   * by po kliknutí chvíli běžel dál odpočet, tedy pravý opak toho, co se děje,
   * a uživatel by nevěděl, jestli se tlačítko chytlo.
   */
  function sendNow() {
    setReleasing(true);
    run(sendCampaignNowAction);
  }

  return (
    <ProgressScreen
      progress={progress}
      releasing={releasing}
      actionFailed={actionFailed}
      reportHref={`${basePath}/campaigns/${progress.campaign_id}/report`}
      onPause={() => run(pauseCampaignAction)}
      onResume={() => run(resumeCampaignAction)}
      onCancel={() => run(cancelCampaignAction)}
      onUndo={() => run(undoCampaignAction)}
      onSendNow={sendNow}
    />
  );
}
