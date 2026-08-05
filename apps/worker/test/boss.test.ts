import { describe, expect, it, vi } from 'vitest';
import { QUEUE_REGISTRY } from '@mlain/core/queues';
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
    work: vi.fn(
      async (_name: string, _options: Record<string, unknown>, _handler: unknown) => 'worker-id',
    ),
    executeSql,
    getDb: () => ({ executeSql }),
  };
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

  it('naplánuje každou frontu, která má cron', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { ...OPTIONS, logger: silentLogger() });
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

    expect(boss.executeSql).toHaveBeenCalledOnce();
    const [text, values] = boss.executeSql.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('UPDATE "pgboss".queue');
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

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
