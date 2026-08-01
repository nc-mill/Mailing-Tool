import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createShutdownController } from '../../src/shutdown/shutdown';

function fakeProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    exit: (code: number) => void;
    exitCalls: number[];
  };
  emitter.exitCalls = [];
  emitter.exit = (code: number) => {
    emitter.exitCalls.push(code);
  };
  return emitter;
}

describe('graceful shutdown', () => {
  it('spustí úklidy v opačném pořadí registrace a skončí kódem 0', async () => {
    const order: string[] = [];
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('první', async () => {
      order.push('první');
    });
    controller.register('druhý', async () => {
      order.push('druhý');
    });
    await controller.shutdown('SIGTERM');
    expect(order).toEqual(['druhý', 'první']);
    expect(proc.exitCalls).toEqual([0]);
  });

  it('na SIGINT reaguje stejně jako na SIGTERM', async () => {
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const done = vi.fn();
    controller.register('x', async () => {
      done();
    });
    controller.listen();
    proc.emit('SIGINT');
    await controller.finished();
    expect(done).toHaveBeenCalledOnce();
  });

  it('druhý signál během shutdownu ukončí proces okamžitě kódem 1', async () => {
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('pomalý', () => new Promise(() => {}));
    controller.listen();
    proc.emit('SIGTERM');
    await Promise.resolve();
    proc.emit('SIGTERM');
    expect(proc.exitCalls).toContain(1);
  });

  it('po vypršení lhůty skončí kódem 1 a zaloguje varování', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 1,
      process: proc as never,
      logger: { info: () => {}, warn, error: () => {} },
    });
    controller.register('nikdy', () => new Promise(() => {}));
    const promise = controller.shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1100);
    await promise;
    expect(warn).toHaveBeenCalled();
    expect(proc.exitCalls).toContain(1);
    vi.useRealTimers();
  });

  it('opakované volání shutdown nespustí úklidy dvakrát', async () => {
    const cleanup = vi.fn(async () => {});
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('x', cleanup);
    await controller.shutdown('SIGTERM');
    await controller.shutdown('SIGTERM');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
