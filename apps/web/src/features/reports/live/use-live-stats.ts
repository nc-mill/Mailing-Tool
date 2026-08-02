'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { campaignStatsUrl, fetchJson } from '../api-client';
import { electLeader } from './leader';
import { chooseLiveMode, detectProtocol, pollIntervalMs } from './live-mode';
import { LiveStatsMachine, type LiveSnapshot, type LiveState } from './live-stats';

/** Jak dlouho následovník čeká na zprávu od vůdce, než si vezme čísla sám. */
const FOLLOWER_TIMEOUT_MS = 30_000;

export type UseLiveStats = {
  snapshot: LiveSnapshot | null;
  state: LiveState;
  refresh: () => void;
};

/**
 * Živé aktualizace se používají výhradně na reportu kampaně ve stavu odesílání.
 * Nikdy na přehledu, nikdy na seznamech. Bez tohohle omezení by i dotazování
 * zbytečně zatěžovalo server.
 *
 * TŘI ODCHYLKY OD PLÁNU, každá kvůli tvrdému požadavku „živé aktualizace musí
 * přežít výpadek a dopočítat se, ne se tiše zastavit".
 *
 * 1. Stav kampaně pro volbu intervalu se čte z REFERENCE, ne z proměnné stavu
 *    Reactu. Plán četl `snapshot?.status` z uzávěru efektu, který se po první
 *    zprávě nikdy neobnoví: kampaň by se dopočítávala po třiceti sekundách
 *    místo po třech, protože v uzávěru je pořád `null`.
 * 2. Zavřený `EventSource` (`readyState === CLOSED`) přepne na dotazování
 *    OKAMŽITĚ, bez čekání na tři pokusy. Prohlížeč po odpovědi 503 sám
 *    znovu nepřipojuje, takže by report zamrzl natrvalo (kritérium 99).
 * 3. Návrat karty do popředí a událost `online` spustí dotaz hned. Po výpadku
 *    sítě se tím čísla dorovnají v řádu okamžiku, ne až po dalším intervalu.
 *    Každá odpověď je ÚPLNÝ snímek, takže dorovnání nemůže vyrobit duplicitu.
 */
export function useLiveStats(
  campaignId: string,
  initial: LiveSnapshot | null,
  /**
   * Stav kampaně, který obrazovka právě zobrazuje. Bez něj by hook do první
   * živé zprávy počítal interval z `sent`, tedy se ptal po třiceti sekundách
   * i u běžící rozesílky, a uživatel by se na zamrzlá čísla díval půl minuty.
   */
  knownStatus?: string | undefined,
): UseLiveStats {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(initial);
  const [state, setState] = useState<LiveState>({
    mode: 'polling',
    attempts: 0,
    degraded: false,
    connection: 'connected',
    lastError: false,
  });
  const machineRef = useRef<LiveStatsMachine | null>(null);
  /** Poslední známý stav kampaně. Interval dotazování na něm stojí. */
  const statusRef = useRef<string>(String(initial?.status ?? 'sent'));

  useEffect(() => {
    if (knownStatus) statusRef.current = knownStatus;
  }, [knownStatus]);

  useEffect(() => {
    let disposed = false;
    const machine = new LiveStatsMachine({
      mode: chooseLiveMode(detectProtocol()),
      fetchSnapshot: (etag) => fetchJson<LiveSnapshot>(campaignStatsUrl(campaignId), { etag }),
    });
    machineRef.current = machine;
    const unsubscribe = machine.subscribe((next) => {
      if (disposed) return;
      statusRef.current = String(next.status ?? statusRef.current);
      setSnapshot(next);
      setState({ ...machine.state });
    });

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let followerWatchdog: (() => void) | null = null;
    let releaseLeader: (() => void) | null = null;

    const loop = async () => {
      if (disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(loop, 5000);
        return;
      }
      await machine.pollOnce();
      if (disposed) return;
      setState({ ...machine.state });
      const interval = pollIntervalMs(statusRef.current, { degraded: machine.state.degraded });
      timer = setTimeout(loop, interval);
    };

    const startPolling = () => {
      if (polling || disposed) return;
      polling = true;
      void loop();
    };

    /** Ruční i automatické dorovnání po výpadku. Vždy úplný snímek. */
    const catchUp = () => {
      if (disposed) return;
      void machine.pollOnce().then(() => {
        if (!disposed) setState({ ...machine.state });
      });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUp();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', catchUp);
    }

    void (async () => {
      const leader = await electLeader(campaignId);
      // Uvolnění patří do úklidu efektu. Bez toho by zavřená karta vůdce
      // nikdy neposlala rezignaci a ostatní karty by na svá čísla čekaly
      // až do vypršení hlídacího intervalu.
      releaseLeader = leader.release;
      if (disposed) {
        leader.release();
        releaseLeader = null;
        return;
      }

      if (!leader.isLeader) {
        // Následovník nedrží spojení. Data mu přeposílá vůdce.
        //
        // Hlídací pes je tu proto, že zavřená karta vůdce by jinak zbytek
        // karet umlčela natrvalo, a to je přesně to „tiché zastavení", které
        // se nesmí stát. Když půl minuty nic nepřijde, karta si čísla začne
        // brát sama.
        let watchdog = setTimeout(startPolling, FOLLOWER_TIMEOUT_MS);
        leader.onMessage((data) => {
          const next = data as LiveSnapshot;
          statusRef.current = String(next.status ?? statusRef.current);
          setSnapshot(next);
          clearTimeout(watchdog);
          watchdog = setTimeout(startPolling, FOLLOWER_TIMEOUT_MS);
        });
        leader.onLeaderGone(() => {
          clearTimeout(watchdog);
          startPolling();
        });
        followerWatchdog = () => clearTimeout(watchdog);
        return;
      }

      if (machine.state.mode === 'sse') {
        source = new EventSource(`/api/v1/campaigns/${campaignId}/stream`, {
          withCredentials: true,
        });
        source.addEventListener('stats', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as LiveSnapshot;
          machine.onStreamMessage(data);
          leader.broadcast(data);
          setState({ ...machine.state });
        });
        source.addEventListener('error', () => {
          const closed = source?.readyState === 2; // EventSource.CLOSED
          machine.onStreamError();
          setState({ ...machine.state });
          if (closed || machine.state.mode === 'polling') {
            source?.close();
            source = null;
            startPolling();
          }
        });
        return;
      }

      startPolling();
    })();

    return () => {
      disposed = true;
      unsubscribe();
      source?.close();
      followerWatchdog?.();
      releaseLeader?.();
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', catchUp);
      }
    };
  }, [campaignId]);

  const refresh = useCallback(() => {
    void machineRef.current?.pollOnce().then(() => {
      if (machineRef.current) setState({ ...machineRef.current.state });
    });
  }, []);

  return { snapshot, state, refresh };
}
