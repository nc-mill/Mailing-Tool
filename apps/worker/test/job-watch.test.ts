import { describe, expect, it, vi } from 'vitest';
import { queue } from '@mlain/core/queues';
import type { ClaimedRunningJobRow } from '@mlain/core/platform/maintenance-scan';
import {
  JOB_ORPHAN_IDLE_MINUTES,
  WATCHED_JOB_KINDS,
  checkOrphanedJobs,
  createJobWatchState,
  startJobWatch,
} from '../src/job-watch';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

/** Fronta tak, jak leží v `pgboss.job`: dvojice jméno fronty a klíč slučování. */
function fakeQueue(jobs: { name: string; singleton_key: string }[]) {
  return {
    executeSql: vi.fn(async (_text: string, _values?: unknown[]) => ({
      rows: jobs as unknown as Record<string, unknown>[],
    })),
  };
}

const WS = '019fdc00-0000-7000-8000-000000000001';

function claimedImport(id: string, idleSeconds = 3600): ClaimedRunningJobRow {
  return { workspaceId: WS, kind: 'import', id, state: 'importing', idleSeconds };
}

function claimedAudience(id: string, idleSeconds = 3600): ClaimedRunningJobRow {
  return { workspaceId: WS, kind: 'campaign_audience', id, state: 'queueing', idleSeconds };
}

const IMPORT_ID = '019fdc3c-1111-7000-8000-000000000002';
const CAMPAIGN_ID = '019fdc3c-2222-7000-8000-000000000003';

describe('hlídač úloh, které tvrdí „běží", a ve frontě k nim nic není', () => {
  it('mlčí, dokud k běžící úloze úloha ve frontě je', async () => {
    const logger = silentLogger();
    const orphans = await checkOrphanedJobs({
      db: fakeQueue([{ name: 'contacts.import', singleton_key: IMPORT_ID }]),
      schema: 'pgboss',
      logger,
      scan: async () => [claimedImport(IMPORT_ID)],
    });
    expect(orphans).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Jádro nálezu. Přesně tenhle stav se 7. 8. naměřil na skutečném řádku:
   * `imports` tvrdí `importing`, v `pgboss.job` po té úloze nic, a rozhraní
   * poctivě ukazuje ukazatel průběhu, který se nikdy nepohne.
   */
  it('nahlásí import, po kterém ve frontě nic nezbylo', async () => {
    const logger = silentLogger();
    const orphans = await checkOrphanedJobs({
      db: fakeQueue([]),
      schema: 'pgboss',
      logger,
      scan: async () => [claimedImport(IMPORT_ID, 7200)],
    });
    expect(orphans).toEqual([
      {
        workspaceId: WS,
        kind: 'import',
        id: IMPORT_ID,
        state: 'importing',
        queue: 'contacts.import',
        idleSeconds: 7200,
      },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  /**
   * Klíč stavby publika je `campaign.materialize:<id>`, ne holé ID. Kdyby se
   * skládal špatně, hlídač by hlásil KAŽDOU stavěnou kampaň jako osiřelou,
   * tedy vyrobil by přesně tu záplavu falešných poplachů, které se jinde brání.
   */
  it('stavbu publika pozná podle složeného klíče fronty', async () => {
    const logger = silentLogger();
    const withJob = await checkOrphanedJobs({
      db: fakeQueue([
        { name: 'campaign.materialize', singleton_key: `campaign.materialize:${CAMPAIGN_ID}` },
      ]),
      schema: 'pgboss',
      logger,
      scan: async () => [claimedAudience(CAMPAIGN_ID)],
    });
    expect(withJob).toEqual([]);

    const withoutJob = await checkOrphanedJobs({
      db: fakeQueue([{ name: 'campaign.materialize', singleton_key: CAMPAIGN_ID }]),
      schema: 'pgboss',
      logger,
      scan: async () => [claimedAudience(CAMPAIGN_ID)],
    });
    expect(withoutJob).toHaveLength(1);
    expect(withoutJob[0]!.queue).toBe('campaign.materialize');
  });

  /**
   * Šablony klíčů se v registru front můžou změnit a hlídač by se s producentem
   * tiše rozešel. Tenhle test je jediné místo, kde se ta vazba měří.
   */
  it('klíč, který hlídač skládá, odpovídá šabloně v registru front', () => {
    for (const watched of WATCHED_JOB_KINDS) {
      expect(queue(watched.queue).singletonKeyTemplate).toBe(watched.singletonKeyTemplate);
    }
  });

  it('stáří se předává skenu, aby se čerstvě spuštěná úloha nehlásila', async () => {
    const scan = vi.fn(async () => []);
    await checkOrphanedJobs({
      db: fakeQueue([]),
      schema: 'pgboss',
      logger: silentLogger(),
      scan,
    });
    expect(scan).toHaveBeenCalledWith(JOB_ORPHAN_IDLE_MINUTES);

    await checkOrphanedJobs({
      db: fakeQueue([]),
      schema: 'pgboss',
      logger: silentLogger(),
      scan,
      idleMinutes: 45,
    });
    expect(scan).toHaveBeenLastCalledWith(45);
  });

  it('s pamětí se hlásí jednou za epizodu a návrat do pořádku se hlásí taky', async () => {
    const logger = silentLogger();
    const state = createJobWatchState();
    const broken = {
      db: fakeQueue([]),
      schema: 'pgboss',
      logger,
      state,
      scan: async () => [claimedImport(IMPORT_ID)],
    };

    await checkOrphanedJobs(broken);
    await checkOrphanedJobs(broken);
    await checkOrphanedJobs(broken);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await checkOrphanedJobs({
      db: fakeQueue([]),
      schema: 'pgboss',
      logger,
      state,
      scan: async () => [],
    });
    expect(logger.info).toHaveBeenCalledTimes(1);

    // Nová epizoda se hlásí znovu, jinak by druhá porucha zůstala tichá.
    await checkOrphanedJobs(broken);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('bez paměti se hlásí každé kolo, což chtějí testy jednotlivých kol', async () => {
    const logger = silentLogger();
    const options = {
      db: fakeQueue([]),
      schema: 'pgboss',
      logger,
      scan: async () => [claimedImport(IMPORT_ID)],
    };
    await checkOrphanedJobs(options);
    await checkOrphanedJobs(options);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  /**
   * Diagnostika nesmí být příčinou pádu workeru. Obě čtení proto chybu spolknou
   * a nahlásí ji jednou; hlásit ji každých pět minut by byl další stotisícový
   * výpis o jediné příčině.
   */
  it('nepovedené čtení fronty hlídač neshodí a hlásí se jednou', async () => {
    const logger = silentLogger();
    const state = createJobWatchState();
    const db = {
      executeSql: vi.fn(async () => {
        throw new Error('permission denied for table job');
      }),
    };
    const scan = vi.fn(async () => [claimedImport(IMPORT_ID)]);

    expect(await checkOrphanedJobs({ db, schema: 'pgboss', logger, state, scan })).toEqual([]);
    expect(await checkOrphanedJobs({ db, schema: 'pgboss', logger, state, scan })).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Fronta se nepřečetla, takže se doména nemá s čím porovnat a neptá se jí.
    expect(scan).not.toHaveBeenCalled();
  });

  it('nepovedený sken domény hlídač neshodí a hlásí se jednou', async () => {
    const logger = silentLogger();
    const state = createJobWatchState();
    const options = {
      db: fakeQueue([]),
      schema: 'pgboss',
      logger,
      state,
      scan: async (): Promise<ClaimedRunningJobRow[]> => {
        throw new Error('chybí DATABASE_URL_MAINTENANCE');
      },
    };
    expect(await checkOrphanedJobs(options)).toEqual([]);
    expect(await checkOrphanedJobs(options)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('nesmyslné schéma se odmítne dřív, než se vloží do dotazu', async () => {
    await expect(
      checkOrphanedJobs({
        db: fakeQueue([]),
        schema: 'pgboss"; DROP TABLE job; --',
        logger: silentLogger(),
        scan: async () => [],
      }),
    ).rejects.toThrow(/není platný identifikátor/);
  });

  it('hlídač jde zastavit a časovač nedrží proces', () => {
    const stop = startJobWatch({
      db: fakeQueue([]),
      schema: 'pgboss',
      logger: silentLogger(),
      scan: async () => [],
      intervalMs: 10_000,
    });
    expect(typeof stop).toBe('function');
    stop();
  });
});
