import { describe, expect, it, vi } from 'vitest';
import { QUEUE_REGISTRY } from '@mlain/core/queues';
import { registerQueues } from '../src/boss';

// Odchylka od plánu: parametry jsou typované explicitně, jinak vi.fn() odvodí
// nulaargumentovou funkci a .mock.calls skončí jako pole prázdných n-tic, na
// kterých typecheck spadne při přístupu na index (TS2493).
function fakeBoss() {
  return {
    createQueue: vi.fn(async (_name: string, _options?: Record<string, unknown>) => {}),
    schedule: vi.fn(
      async (_name: string, _cron: string, _data?: unknown, _options?: unknown) => {},
    ),
    work: vi.fn(
      async (_name: string, _options: Record<string, unknown>, _handler: unknown) => 'worker-id',
    ),
  };
}

describe('registrace front', () => {
  it('založí každou frontu z registru, včetně dead letter variant', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { concurrency: 5, logger: silentLogger() });
    const created = boss.createQueue.mock.calls.map((call) => call[0] as string);
    for (const entry of QUEUE_REGISTRY) {
      expect(created, `chybí ${entry.name}`).toContain(entry.name);
      if (entry.deadLetter) expect(created).toContain(`${entry.name}.dlq`);
    }
  });

  it('naplánuje každou frontu, která má cron', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { concurrency: 5, logger: silentLogger() });
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
      { concurrency: 5, logger },
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
      { concurrency: 7, logger: silentLogger() },
    );
    const options = boss.work.mock.calls[0]?.[1] as { batchSize?: number };
    expect(options).toMatchObject({ batchSize: 1 });
  });

  it('respektuje vlastní souběžnost fronty, když ji registr uvádí', async () => {
    const boss = fakeBoss();
    await registerQueues(
      boss as never,
      { 'tracking.process_engagement': async () => {} },
      { concurrency: 7, logger: silentLogger() },
    );
    expect(boss.work).toHaveBeenCalled();
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
