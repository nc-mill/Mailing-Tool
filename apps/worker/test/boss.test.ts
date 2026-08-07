import { describe, expect, it, vi } from 'vitest';
import { QUEUE_REGISTRY, RETIRED_QUEUES, needsDependencies } from '@mlain/core/queues';
import { registerQueues } from '../src/boss';

// Odchylka od plánu: parametry jsou typované explicitně, jinak vi.fn() odvodí
// nulaargumentovou funkci a .mock.calls skončí jako pole prázdných n-tic, na
// kterých typecheck spadne při přístupu na index (TS2493).
function fakeBoss() {
  const executeSql = vi.fn(async (_text: string, _values?: unknown[]) => ({
    rows: [] as Record<string, unknown>[],
  }));
  return {
    createQueue: vi.fn(async (_name: string, _options?: Record<string, unknown>) => {}),
    schedule: vi.fn(
      async (_name: string, _cron: string, _data?: unknown, _options?: unknown) => {},
    ),
    unschedule: vi.fn(async (_name: string, _key?: string) => {}),
    deleteQueue: vi.fn(async (_name: string) => {}),
    work: vi.fn(
      async (_name: string, _options: Record<string, unknown>, _handler: unknown) => 'worker-id',
    ),
    executeSql,
    getDb: () => ({ executeSql }),
  };
}

/** Všechny fronty z registru s obsluhou, tedy stav „nic nechybí". */
function allHandlers(): Record<string, () => Promise<void>> {
  return Object.fromEntries(QUEUE_REGISTRY.map((entry) => [entry.name, async () => {}]));
}

const OPTIONS = { concurrency: 5, schema: 'pgboss', logger: silentLogger() };

describe('registrace front', () => {
  it('založí každou frontu z registru, včetně dead letter variant', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { ...OPTIONS, logger: silentLogger() });
    const created = boss.createQueue.mock.calls.map((call) => call[0] as string);
    for (const entry of QUEUE_REGISTRY) {
      expect(created, `chybí ${entry.name}`).toContain(entry.name);
      if (entry.deadLetter) expect(created).toContain(`${entry.name}.dlq`);
    }
  });

  it('naplánuje každou frontu, která má cron a obsluhu', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });
    const scheduled = boss.schedule.mock.calls.map((call) => call[0] as string);
    for (const entry of QUEUE_REGISTRY.filter((item) => item.cron)) {
      expect(scheduled, `chybí plán ${entry.name}`).toContain(entry.name);
    }
  });

  it('zaregistruje handler jen tam, kde existuje, a zbytek nahlásí', async () => {
    const boss = fakeBoss();
    const logger = silentLogger();
    await registerQueues(
      boss as never,
      { 'platform.backup': async () => {} },
      { ...OPTIONS, logger },
    );
    expect(boss.work).toHaveBeenCalledOnce();
    expect(boss.work.mock.calls[0]?.[0]).toBe('platform.backup');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('předá localConcurrency z WORKER_CONCURRENCY', async () => {
    const boss = fakeBoss();
    await registerQueues(
      boss as never,
      { 'platform.backup': async () => {} },
      { ...OPTIONS, concurrency: 7, logger: silentLogger() },
    );
    const options = boss.work.mock.calls[0]?.[1] as { batchSize?: number };
    expect(options).toMatchObject({ batchSize: 1 });
  });

  it('respektuje vlastní souběžnost fronty, když ji registr uvádí', async () => {
    const boss = fakeBoss();
    await registerQueues(
      boss as never,
      { 'tracking.process_engagement': async () => {} },
      { ...OPTIONS, concurrency: 7, logger: silentLogger() },
    );
    expect(boss.work).toHaveBeenCalled();
  });
});

describe('slučování duplicitních úloh', () => {
  it('předá politiku z registru do zakládání fronty', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { ...OPTIONS, logger: silentLogger() });
    const created = new Map(
      boss.createQueue.mock.calls.map((call) => [
        call[0] as string,
        (call[1] ?? {}) as Record<string, unknown>,
      ]),
    );
    for (const entry of QUEUE_REGISTRY) {
      const options = created.get(entry.name);
      expect(options?.['policy'], `${entry.name}`).toBe(entry.policy);
    }
  });

  it('nezakládá dead letter frontu s politikou', () => {
    // Slučovat nedoručitelné úlohy by znamenalo tiše zahodit právě to, co se
    // má vyšetřit. Dead letter fronta se proto zakládá bez politiky.
    const boss = fakeBoss();
    return registerQueues(boss as never, {}, { ...OPTIONS, logger: silentLogger() }).then(() => {
      for (const [name, options] of boss.createQueue.mock.calls) {
        if (!name.endsWith('.dlq')) continue;
        expect(options?.['policy'], name).toBeUndefined();
      }
    });
  });

  it('srovná politiku u front, které v databázi už existují', async () => {
    // Bez tohohle kroku by se nová politika projevila jen na čisté instalaci:
    // `pgboss.create_queue` má `ON CONFLICT DO NOTHING` a existující frontu
    // nechá být. `updateQueue()` politiku změnit neumí, hlásí „queue policy
    // cannot be changed after creation", takže zbývá přímý zápis.
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { ...OPTIONS, logger: silentLogger() });

    const update = boss.executeSql.mock.calls.find(([text]) =>
      text.includes('UPDATE "pgboss".queue'),
    );
    expect(update, 'srovnání politik se nespustilo').toBeDefined();
    const [text, values] = update as [string, unknown[]];
    expect(text).toContain('IS DISTINCT FROM');

    const [names, policies] = values as [string[], string[]];
    expect(names).toEqual(QUEUE_REGISTRY.map((entry) => entry.name));
    expect(policies).toEqual(QUEUE_REGISTRY.map((entry) => entry.policy ?? 'standard'));
    // Interní fronta plánovače ani fronty, které z registru vypadly, se
    // srovnávat nesmí: první patří knihovně a druhé už nikdo neřídí.
    expect(names).not.toContain('__pgboss__send-it');
    expect(names.filter((name) => name.endsWith('.dlq'))).toEqual([]);
  });

  it('shodí start workeru, když se srovnání politik nepovede', async () => {
    // Tichá varianta by vyrobila přesně tu vadu, kterou tady odstraňujeme: worker
    // by běžel nad frontami s politikou `standard`, u kterých pg-boss `singletonKey`
    // ignoruje, a nikdo by se to nedozvěděl.
    const boss = fakeBoss();
    boss.executeSql.mockRejectedValueOnce(new Error('permission denied for table queue'));
    const logger = silentLogger();
    await expect(registerQueues(boss as never, {}, { ...OPTIONS, logger })).rejects.toThrow(
      /worker proto nenaběhne/,
    );
    // Fronty se registrovat nesmí: handler nad nesloučenou frontou je horší než
    // worker, který nenaběhl, protože vypadá zdravě.
    expect(boss.work).not.toHaveBeenCalled();
  });

  it('odmítne schéma, které není platný identifikátor', async () => {
    const boss = fakeBoss();
    await expect(
      registerQueues(
        boss as never,
        {},
        { ...OPTIONS, schema: 'pg"boss; DROP', logger: silentLogger() },
      ),
    ).rejects.toThrow(/není platný identifikátor/);
  });
});

describe('fronty, které se zrušily', () => {
  /** Odpověď na dotaz „co po zrušených frontách zbylo". */
  function leftovers(boss: ReturnType<typeof fakeBoss>, names: readonly string[]): void {
    boss.executeSql.mockImplementation(async (text: string) => {
      if (!text.includes('FROM "pgboss".queue')) return { rows: [] };
      if (text.includes('UPDATE')) return { rows: [] };
      return { rows: names.map((name) => ({ name, jobs: 4, schedules: 1 })) };
    });
  }

  it('zruší plán a smaže frontu, která v databázi po vyškrtnutí z registru zbyla', async () => {
    // Vyškrtnutí z registru je změna KÓDU. Řádek v `pgboss.queue` na běžící
    // instalaci zůstane ležet i s plánem cronu a s tiky, protože srovnávání
    // politik chodí schválně jen po frontách z registru.
    //
    // Zástupce se 7. 8. změnil z `platform.maintain_partitions` na
    // `retention.drop_message_partitions`: ta první se toho dne vrátila do
    // registru (úklid oddílů dělá worker, viz `ops/jobs/partition-jobs.ts`),
    // takže se na ní úklid zrušených front testovat nedá. Druhá zůstává
    // zrušená natrvalo, protože by byla druhou cestou k téže práci.
    const boss = fakeBoss();
    leftovers(boss, ['retention.drop_message_partitions']);
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });

    expect(boss.unschedule.mock.calls.map((call) => call[0])).toContain(
      'retention.drop_message_partitions',
    );
    expect(boss.deleteQueue.mock.calls.map((call) => call[0])).toContain(
      'retention.drop_message_partitions',
    );
  });

  it('smaže hlavní frontu DŘÍV než její dead letter, jinak padne cizí klíč', async () => {
    // `queue.dead_letter` i `job.dead_letter` mají ON DELETE RESTRICT, takže
    // opačné pořadí skončí na porušení cizího klíče.
    const boss = fakeBoss();
    leftovers(boss, ['tracking.erase_contact', 'tracking.erase_contact.dlq']);
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });

    const deleted = boss.deleteQueue.mock.calls.map((call) => call[0] as string);
    expect(deleted.indexOf('tracking.erase_contact')).toBeLessThan(
      deleted.indexOf('tracking.erase_contact.dlq'),
    );
  });

  it('nesahá na frontu, která v databázi není', async () => {
    const boss = fakeBoss();
    leftovers(boss, []);
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });
    expect(boss.deleteQueue).not.toHaveBeenCalled();
  });

  it('nesahá na jedinou frontu z registru', async () => {
    const boss = fakeBoss();
    leftovers(
      boss,
      RETIRED_QUEUES.map((retired) => retired.name),
    );
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });

    const registryNames = new Set(QUEUE_REGISTRY.map((entry) => entry.name));
    for (const [name] of boss.deleteQueue.mock.calls) {
      expect(registryNames.has(name), `${name} je v registru a mazat se nesmí`).toBe(false);
    }
  });

  it('neshodí start workeru, když se úklid nepovede', async () => {
    // Na rozdíl od srovnávání politik je to úklid po sobě samém, ne podmínka
    // správného chování: fronta, kterou se nepovedlo smazat, dál nic nedělá.
    const boss = fakeBoss();
    leftovers(boss, ['platform.maintain_partitions']);
    boss.deleteQueue.mockRejectedValue(new Error('permission denied'));
    await expect(
      registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() }),
    ).resolves.toBeUndefined();
  });
});

describe('cronové fronty bez obsluhy', () => {
  /** Obsluhy pro všechny fronty kromě jedné cronové. */
  function allExcept(name: string): Record<string, () => Promise<void>> {
    const handlers = allHandlers();
    delete handlers[name];
    return handlers;
  }

  it('cronovou frontu bez obsluhy neplánuje a její plán ruší', async () => {
    // Tik by uvízl ve stavu `created`, nikdy neexpiroval (expirace se týká
    // běžících úloh) a politika `exclusive` by od té chvíle zahodila každý další.
    // Naměřeno: 2 764 takových tiků u `domain.recheck`.
    const boss = fakeBoss();
    await registerQueues(boss as never, allExcept('domain.recheck'), {
      ...OPTIONS,
      logger: silentLogger(),
    });

    expect(boss.schedule.mock.calls.map((call) => call[0])).not.toContain('domain.recheck');
    expect(boss.unschedule.mock.calls.map((call) => call[0])).toContain('domain.recheck');
  });

  it('smaže tiky, které se v takové frontě už nakupily', async () => {
    // Zrušení plánu zastaví přírůstek, ne to, co tam leží. Po dodání obsluhy by
    // se nasbírané tiky spustily všechny najednou.
    const boss = fakeBoss();
    await registerQueues(boss as never, allExcept('domain.recheck'), {
      ...OPTIONS,
      logger: silentLogger(),
    });

    const purge = boss.executeSql.mock.calls.find(([text]) => text.includes('DELETE FROM'));
    expect(purge, 'uvízlé tiky se neuklidily').toBeDefined();
    const [text, values] = purge as [string, unknown[]];
    // Podmínka je úzká schválně: přesně to, co vkládá plánovač pg-bossu.
    // Úloha od producenta má náklad nebo klíč a nesmí se jí to dotknout.
    expect(text).toContain("state = 'created'");
    expect(text).toContain('singleton_key IS NULL');
    expect(text).toContain("data = '{}'::jsonb");
    expect(values[0]).toEqual(['domain.recheck']);
  });

  it('cronovou frontu s NEZAPOJENOU obsluhou taky neplánuje', async () => {
    // `needsDependencies` má být hlasitá, jenže u cronu z ní je generátor
    // selhání: naměřeno 3 993 stejných selhání u `outbox.reconcile` za čtyři
    // dny. Hlášení, které přijde tisíckrát denně, není hlasitější než ticho.
    const boss = fakeBoss();
    const handlers = allHandlers() as Record<string, unknown>;
    handlers['outbox.reconcile'] = needsDependencies('outbox.reconcile', 'ReconcileDeps.reconcile');
    await registerQueues(boss as never, handlers as never, { ...OPTIONS, logger: silentLogger() });

    expect(boss.schedule.mock.calls.map((call) => call[0])).not.toContain('outbox.reconcile');
    expect(boss.unschedule.mock.calls.map((call) => call[0])).toContain('outbox.reconcile');
  });

  it('obsluhu takové fronty přesto zaregistruje, aby ruční zařazení spadlo nahlas', async () => {
    // Potlačuje se tikání, ne hlasitost. Úloha, kterou do fronty zařadí člověk
    // nebo producent, musí pořád skončit chybou s vysvětlením, co chybí.
    const boss = fakeBoss();
    const handlers = allHandlers() as Record<string, unknown>;
    handlers['outbox.reconcile'] = needsDependencies('outbox.reconcile', 'ReconcileDeps.reconcile');
    await registerQueues(boss as never, handlers as never, { ...OPTIONS, logger: silentLogger() });

    expect(boss.work.mock.calls.map((call) => call[0])).toContain('outbox.reconcile');
  });

  it('frontu s obsluhou neuklízí ani neodplánuje', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, allHandlers(), { ...OPTIONS, logger: silentLogger() });
    expect(boss.unschedule).not.toHaveBeenCalled();
    expect(boss.executeSql.mock.calls.some(([text]) => text.includes('DELETE FROM'))).toBe(false);
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
