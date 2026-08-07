'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { JobsBadge } from '@mlain/ui/patterns/jobs';
import { useCallback, useEffect, useState } from 'react';
import type { JobsResponse } from './job-view';
import { JOBS_BADGE_REFRESH_MS } from './refresh';
import { useJobsLabels } from './use-jobs-labels';

/**
 * Odznak úloh v hlavičce. Ukazuje počet BĚŽÍCÍCH úloh a vede do Centra úloh.
 *
 * POČET SE NAČÍTÁ V PROHLÍŽEČI, ne ve skořápce na serveru, a je to schválně.
 * Serverová skořápka se vykresluje u KAŽDÉ stránky aplikace, takže dotaz
 * odtamtud by přidal sedmé volání na API do každého vykreslení a zdržel
 * první vykreslení o svou vlastní latenci. Odsud je to jedno volání po
 * hydrataci, které nikoho nebrzdí, a hlavička je do té doby vidět s nulou.
 *
 * Dotazuje se jen s `limit=1`: z odpovědi potřebuje `running_count`, ne seznam.
 */
export function JobsBadgeLive({
  workspaceId,
  jobsHref,
}: {
  workspaceId: string;
  jobsHref: string;
}) {
  const router = useRouter();
  const labels = useJobsLabels();
  const [running, setRunning] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/jobs?limit=1&running=true', {
        headers: { 'X-Workspace-Id': workspaceId, accept: 'application/json' },
      });
      if (!response.ok) return;
      const body = (await response.json()) as JobsResponse;
      setRunning(body.running_count);
    } catch {
      // Odznak je doplněk hlavičky. Když se počet nenačte, zůstane poslední
      // známý; hlásit chybu v hlavičce každé stránky by bylo horší než mlčet.
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Dotazuje se, JEN dokud něco běží (zdůvodnění v `refresh.ts`). Jakmile
   * počet klesne na nulu, časovač se zruší a hlavička je zase zadarmo.
   *
   * Cena: úloha spuštěná v jiné záložce se v téhle objeví až po jejím
   * přenačtení. To je vědomý ústupek, ne opomenutí. Kdo úlohu spustil,
   * dívá se na obrazovku, ze které ji spustil.
   */
  useEffect(() => {
    if (running === 0) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, JOBS_BADGE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  return <JobsBadge runningCount={running} labels={labels} onOpen={() => router.push(jobsHref)} />;
}
