import { describe, expect, it, vi } from 'vitest';
import { cronQueues, queue } from '@mlain/core/queues';
import {
  CRON_EVIDENCE_WINDOW_SECONDS,
  CRON_SILENCE_FLOOR_SECONDS,
  checkCronQueues,
  checkSilentCronQueues,
  createCronWatchState,
  startCronWatch,
} from '../src/cron-watch';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function fakeDb(rows: Record<string, unknown>[]) {
  return {
    executeSql: vi.fn(async (_text: string, _values?: unknown[]) => ({ rows })),
  };
}

const DAY = 24 * 60 * 60;

/**
 * Databáze pro hlídač ticha. Odpovídá podle toho, na co se ptá: napřed na
 * značku plánovače (`version`), pak na plány a stáří jejich úloh.
 */
function fakeSilenceDb(input: {
  lastTickSeconds?: number | null;
  /** Prázdné pole znamená, že v `pgboss.schedule` není nic, tedy nic se neplánuje. */
  schedules?: {
    name: string;
    scheduled_age_seconds: number;
    last_job_age_seconds: number | null;
  }[];
}) {
  // Schválně ne `?? 10`: `null` je platná hodnota (značku nikdo neposunul)
  // a slučovací operátor by ji přepsal na desítku, takže by ten případ nešlo
  // vůbec otestovat.
  const version = [{ last_tick_seconds: 'lastTickSeconds' in input ? input.lastTickSeconds : 10 }];
  const schedules = input.schedules ?? [];
  return {
    executeSql: vi.fn(async (text: string, _values?: unknown[]) => ({
      rows: text.includes('.version') ? version : (schedules as Record<string, unknown>[]),
    })),
  };
}

const SCHEDULER = queue('campaign.scheduler');

describe('hlídač zahazovaných tiků z cronu', () => {
  it('mlčí, dokud je tik mladší než expirace fronty', async () => {
    const logger = silentLogger();
    const stalled = await checkCronQueues({
      db: fakeDb([
        {
          name: 'campaign.scheduler',
          state: 'active',
          age_seconds: SCHEDULER.expireInSeconds - 1,
        },
      ]),
      schema: 'pgboss',
      logger,
    });
    expect(stalled).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Jádro nálezu: tik uvízlý v `created` je ten nejhorší případ, protože ho
   * neuklidí ani dozorčí smyčka pg-bossu (expirace se týká běžících úloh).
   * Fronta je od té chvíle zamčená natrvalo a dnes o tom nikde není řádka.
   */
  it('nahlásí frontu, jejíž tik leží déle než expirace, i s názvem a stavem', async () => {
    const logger = silentLogger();
    const stalled = await checkCronQueues({
      db: fakeDb([
        {
          name: 'campaign.scheduler',
          state: 'created',
          age_seconds: SCHEDULER.expireInSeconds + 60,
        },
      ]),
      schema: 'pgboss',
      logger,
    });
    expect(stalled).toEqual([
      {
        queue: 'campaign.scheduler',
        state: 'created',
        ageSeconds: SCHEDULER.expireInSeconds + 60,
        expireSeconds: SCHEDULER.expireInSeconds,
      },
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ queue: 'campaign.scheduler' });
  });

  it('ptá se jen na fronty, které mají v registru cron', async () => {
    const db = fakeDb([]);
    await checkCronQueues({ db, schema: 'pgboss', logger: silentLogger() });
    const names = db.executeSql.mock.calls[0]?.[1] as string[][];
    expect(names[0]?.sort()).toEqual(
      cronQueues()
        .map((entry) => entry.name)
        .sort(),
    );
  });

  it('nesahá na frontu, která v registru cron nemá', async () => {
    const logger = silentLogger();
    const stalled = await checkCronQueues({
      // `campaign.materialize` cron nemá, dlouho běžící materializace je normální stav.
      db: fakeDb([{ name: 'campaign.materialize', state: 'active', age_seconds: 999_999 }]),
      schema: 'pgboss',
      logger,
    });
    expect(stalled).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Diagnostika nesmí shodit workera. Chyba dotazu se zaloguje a příští kolo
   * to zkusí znovu; výměna tichého zahazování za hlasitý pád by byla horší.
   */
  it('při chybě dotazu nevyhodí, jen to nahlásí', async () => {
    const logger = silentLogger();
    const db = {
      executeSql: vi.fn(async () => {
        throw new Error('permission denied for table job');
      }),
    };
    await expect(checkCronQueues({ db: db as never, schema: 'pgboss', logger })).resolves.toEqual(
      [],
    );
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('odmítne schéma, které není platný identifikátor', async () => {
    await expect(
      checkCronQueues({ db: fakeDb([]), schema: 'pg"boss', logger: silentLogger() }),
    ).rejects.toThrow(/není platný identifikátor/);
  });

  /**
   * Hlášení, které přijde každých pět minut a pokaždé stejné, se přestane
   * číst. Ověřeno na `outbox.reconcile`: 3 993 shodných selhání za čtyři dny
   * a nikdo si jich nevšiml.
   */
  it('tutéž zaseknutou frontu hlásí jednou, ne v každém kole', async () => {
    const logger = silentLogger();
    const state = createCronWatchState();
    const db = fakeDb([
      {
        name: 'campaign.scheduler',
        state: 'created',
        age_seconds: SCHEDULER.expireInSeconds + 60,
      },
    ]);
    await checkCronQueues({ db, schema: 'pgboss', logger, state });
    await checkCronQueues({ db, schema: 'pgboss', logger, state });
    await checkCronQueues({ db, schema: 'pgboss', logger, state });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('uvolněný tik hlásí jako návrat do provozu, aby šlo poznat, že porucha skončila', async () => {
    const logger = silentLogger();
    const state = createCronWatchState();
    await checkCronQueues({
      db: fakeDb([
        {
          name: 'campaign.scheduler',
          state: 'created',
          age_seconds: SCHEDULER.expireInSeconds + 60,
        },
      ]),
      schema: 'pgboss',
      logger,
      state,
    });
    await checkCronQueues({ db: fakeDb([]), schema: 'pgboss', logger, state });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({ queues: ['campaign.scheduler'] });
  });

  it('vrácená funkce časovač zastaví', async () => {
    const db = fakeDb([]);
    const stop = startCronWatch({ db, schema: 'pgboss', logger: silentLogger(), intervalMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterRunning = db.executeSql.mock.calls.length;
    expect(afterRunning).toBeGreaterThan(0);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.executeSql.mock.calls.length).toBe(afterRunning);
  });
});

describe('hlídač ticha cronových front', () => {
  const CLEANUP = 'platform.cleanup_sessions'; // cron `15 2 * * *`, tedy jednou denně
  const SCHEDULER_QUEUE = 'campaign.scheduler'; // cron `*/30 * * * * *`, tedy po 30 sekundách

  it('nahlásí frontu, jejíž poslední úloha je starší než násobek periody', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [
          { name: CLEANUP, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 4 * DAY },
        ],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues).toEqual([
      {
        queue: CLEANUP,
        cron: '15 2 * * *',
        periodSeconds: DAY,
        toleranceSeconds: 3 * DAY,
        silentForSeconds: 4 * DAY,
        since: 'last_job',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('mlčí, dokud je poslední úloha mladší než tolerance', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [
          { name: CLEANUP, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 2 * DAY },
        ],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * PAST, KVŮLI KTERÉ TENHLE HLÍDAČ MŮŽE HLÁSIT ZÁMĚR JAKO PORUCHU. Cronové
   * fronty bez obsluhy a fronty s nezapojenou obsluhou se od 7. 8. schválně
   * NEPLÁNUJÍ a jejich plán se ruší. Hlídač je proto bere z `pgboss.schedule`,
   * ne z registru: co v té tabulce není, mlčet SMÍ.
   */
  it('nesahá na cronovou frontu, která v pgboss.schedule není', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({ schedules: [] }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('čerstvě naplánovaná fronta bez jediné úlohy není porucha', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        // Instalace běží deset minut. Denní úklid v ní opravdu ještě neproběhl.
        schedules: [{ name: CLEANUP, scheduled_age_seconds: 600, last_job_age_seconds: null }],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('naplánovaná fronta, která nedoběhla ani jednou, se hlásí jako never_ran', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [{ name: CLEANUP, scheduled_age_seconds: 5 * DAY, last_job_age_seconds: null }],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues[0]).toMatchObject({
      queue: CLEANUP,
      since: 'never_ran',
      silentForSeconds: 5 * DAY,
    });
  });

  /**
   * pg-boss maže dokončené úlohy po sedmi dnech, takže z chybějícího řádku
   * se delší ticho doložit nedá. Hlídač ho proto ani netvrdí.
   */
  it('ticho bez úloh netvrdí déle, než jak dlouho by úloha v tabulce ležela', async () => {
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [
          { name: CLEANUP, scheduled_age_seconds: 400 * DAY, last_job_age_seconds: null },
        ],
      }),
      schema: 'pgboss',
      logger: silentLogger(),
    });
    expect(report.queues[0]?.silentForSeconds).toBe(CRON_EVIDENCE_WINDOW_SECONDS);
  });

  it('u rychlé fronty platí dolní mez tolerance, ne trojnásobek půlminuty', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        // Minuta a půl ticha u půlminutového cronu: nasazení, ne porucha.
        schedules: [
          { name: SCHEDULER_QUEUE, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 90 },
        ],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.queues).toEqual([]);

    const later = await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [
          {
            name: SCHEDULER_QUEUE,
            scheduled_age_seconds: 30 * DAY,
            last_job_age_seconds: CRON_SILENCE_FLOOR_SECONDS + 1,
          },
        ],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(later.queues[0]?.toleranceSeconds).toBe(CRON_SILENCE_FLOOR_SECONDS);
  });

  /**
   * Když stojí plánovač, stojí všechny fronty naráz. Vypsat je jednu po druhé
   * by znamenalo dvacet řádků o jediné příčině, tedy přesně ten druh hlášení,
   * kterého si nikdo nevšimne.
   */
  it('zastavený plánovač hlásí jednou větou a jednotlivé fronty už ne', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({
        lastTickSeconds: 3600,
        schedules: [
          { name: CLEANUP, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 4 * DAY },
          { name: SCHEDULER_QUEUE, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 4 * DAY },
        ],
      }),
      schema: 'pgboss',
      logger,
    });
    expect(report.monitor).toMatchObject({ lastTickSeconds: 3600 });
    expect(report.queues).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('značka plánovače, kterou nikdo nikdy neposunul, je taky porucha', async () => {
    const logger = silentLogger();
    const report = await checkSilentCronQueues({
      db: fakeSilenceDb({ lastTickSeconds: null }),
      schema: 'pgboss',
      logger,
    });
    expect(report.monitor).toMatchObject({ lastTickSeconds: null });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('tutéž mlčící frontu hlásí jednou, a její rozběhnutí taky', async () => {
    const logger = silentLogger();
    const state = createCronWatchState();
    const silent = {
      db: fakeSilenceDb({
        schedules: [
          { name: CLEANUP, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 4 * DAY },
        ],
      }),
      schema: 'pgboss',
      logger,
      state,
    };
    await checkSilentCronQueues(silent);
    await checkSilentCronQueues(silent);
    await checkSilentCronQueues(silent);
    expect(logger.warn).toHaveBeenCalledOnce();

    await checkSilentCronQueues({
      db: fakeSilenceDb({
        schedules: [{ name: CLEANUP, scheduled_age_seconds: 30 * DAY, last_job_age_seconds: 60 }],
      }),
      schema: 'pgboss',
      logger,
      state,
    });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({ queues: [CLEANUP] });
  });

  it('při chybě dotazu nevyhodí a nehlásí to donekonečna', async () => {
    const logger = silentLogger();
    const state = createCronWatchState();
    const db = {
      executeSql: vi.fn(async () => {
        throw new Error('permission denied for table schedule');
      }),
    };
    const options = { db: db as never, schema: 'pgboss', logger, state };
    await expect(checkSilentCronQueues(options)).resolves.toEqual({ monitor: null, queues: [] });
    await checkSilentCronQueues(options);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('odmítne schéma, které není platný identifikátor', async () => {
    await expect(
      checkSilentCronQueues({
        db: fakeSilenceDb({}),
        schema: 'pg"boss',
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/není platný identifikátor/);
  });
});
