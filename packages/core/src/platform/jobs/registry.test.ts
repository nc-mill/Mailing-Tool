import { beforeEach, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import {
  cancelJob,
  clearJobSources,
  getJob,
  listJobs,
  registerJobSource,
  registeredJobKinds,
  type JobCancelOutcome,
  type JobRecord,
} from './registry';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const ctx = unsafeWorkspaceContext(WS, {
  type: 'user',
  userId: '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071',
  role: 'admin',
});

const job = (id: string, status: JobRecord['status'], updatedAt: string): JobRecord => ({
  id,
  kind: 'import',
  title: 'Import kontaktů',
  status,
  done: 3,
  total: 10,
  startedBy: 'Petr',
  startedAt: updatedAt,
  updatedAt,
  finishedAt: null,
  note: null,
  cancellable: status === 'running' || status === 'paused',
  stopping: false,
});

beforeEach(() => {
  clearJobSources();
});

describe('registr zdrojů úloh', () => {
  it('bez registrovaného zdroje vrací prázdno, ne chybu', async () => {
    expect(registeredJobKinds()).toEqual([]);
    expect(await listJobs(ctx, { limit: 20 })).toEqual([]);
  });

  it('slévá úlohy z víc zdrojů a řadí od nejnovější změny', async () => {
    registerJobSource({
      kind: 'import',
      list: async () => [job('a', 'running', '2026-08-01T10:00:00.000Z')],
      get: async () => null,
    });
    registerJobSource({
      kind: 'campaign_audience',
      list: async () => [
        { ...job('b', 'completed', '2026-08-01T12:00:00.000Z'), kind: 'campaign_audience' },
      ],
      get: async () => null,
    });
    const jobs = await listJobs(ctx, { limit: 20 });
    expect(jobs.map((j) => j.id)).toEqual(['b', 'a']);
  });

  it('dvojí registrace téhož druhu je chyba, ne tiché přepsání', () => {
    const source = { kind: 'import', list: async () => [], get: async () => null };
    registerJobSource(source);
    // Tiché přepsání by znamenalo, že jeden ze dvou plánů dodal zdroj, který
    // se nikdy nezavolá, a nikdo by si toho nevšiml.
    expect(() => registerJobSource(source)).toThrow(/import/);
  });

  it('pád jednoho zdroje neshodí celý výpis', async () => {
    registerJobSource({
      kind: 'import',
      list: async () => {
        throw new Error('databáze je pryč');
      },
      get: async () => null,
    });
    registerJobSource({
      kind: 'campaign_audience',
      list: async () => [
        { ...job('b', 'running', '2026-08-01T12:00:00.000Z'), kind: 'campaign_audience' },
      ],
      get: async () => null,
    });
    // Centrum úloh je diagnostická obrazovka. Kdyby ji shodil jeden rozbitý
    // zdroj, uživatel by přišel i o informace o všech ostatních úlohách,
    // tedy přesně ve chvíli, kdy je potřebuje nejvíc.
    const jobs = await listJobs(ctx, { limit: 20 });
    expect(jobs.map((j) => j.id)).toEqual(['b']);
  });

  it('detail se hledá jen u zdroje, kterému druh patří', async () => {
    let importAsked = 0;
    registerJobSource({
      kind: 'import',
      list: async () => [],
      get: async (_c, id) => {
        importAsked += 1;
        return id === 'a' ? job('a', 'running', '2026-08-01T10:00:00.000Z') : null;
      },
    });
    expect(await getJob(ctx, 'import', 'a')).toMatchObject({ id: 'a' });
    expect(await getJob(ctx, 'import', 'zz')).toBeNull();
    expect(await getJob(ctx, 'neznamy_druh', 'a')).toBeNull();
    expect(importAsked, 'neznámý druh se nemá nikoho ptát').toBe(2);
  });

  it('limit se uplatní až po slití, ne na každý zdroj zvlášť', async () => {
    for (const kind of ['import', 'campaign_audience', 'export']) {
      registerJobSource({
        kind,
        list: async () => [
          { ...job(`${kind}-1`, 'running', '2026-08-01T10:00:00.000Z'), kind },
          { ...job(`${kind}-2`, 'running', '2026-08-01T09:00:00.000Z'), kind },
        ],
        get: async () => null,
      });
    }
    expect(await listJobs(ctx, { limit: 4 })).toHaveLength(4);
  });
});

describe('zastavení úlohy', () => {
  const assertAll = { assert: () => {} };

  /** Zdroj, který si pamatuje stav a chová se jako doména: druhý zásah nezabere. */
  function cancellableSource(initial: JobRecord) {
    let current = initial;
    let runs = 0;
    return {
      calls: () => runs,
      current: () => current,
      source: {
        kind: current.kind,
        list: async () => [current],
        get: async (_c: unknown, id: string) => (id === current.id ? current : null),
        cancel: {
          permission: 'contacts:import' as const,
          run: async (): Promise<JobCancelOutcome> => {
            runs += 1;
            if (current.status === 'cancelled') return 'already_cancelled';
            if (!current.cancellable) return 'already_finished';
            current = { ...current, status: 'cancelled', cancellable: false, stopping: true };
            return 'cancelling';
          },
        },
      },
    };
  }

  it('zdroj bez zrušení odpoví `unsupported`, ne chybou', async () => {
    registerJobSource({
      kind: 'import',
      list: async () => [],
      get: async () => job('a', 'running', '2026-08-01T10:00:00.000Z'),
    });
    const result = await cancelJob(ctx, 'import', 'a', assertAll);
    expect(result.status).toBe('unsupported');
  });

  it('neznámý druh i neznámé ID končí stejně, tedy `not_found`', async () => {
    const { source } = cancellableSource(job('a', 'running', '2026-08-01T10:00:00.000Z'));
    registerJobSource(source);
    expect(await cancelJob(ctx, 'import', 'zz', assertAll)).toEqual({ status: 'not_found' });
    expect(await cancelJob(ctx, 'export', 'a', assertAll)).toEqual({ status: 'not_found' });
  });

  it('oprávnění se ověří DŘÍV, než se cokoli zastaví', async () => {
    const fake = cancellableSource(job('a', 'running', '2026-08-01T10:00:00.000Z'));
    registerJobSource(fake.source);
    await expect(
      cancelJob(ctx, 'import', 'a', {
        assert: (permission) => {
          throw new Error(`chybí ${permission}`);
        },
      }),
    ).rejects.toThrow(/contacts:import/);
    // Kdyby se doména zavolala i tak, bylo by Centrum úloh cesta kolem
    // oprávnění domény: seznam vidí i role, která zasahovat nesmí.
    expect(fake.calls()).toBe(0);
    expect(fake.current().status).toBe('running');
  });

  it('druhé kliknutí není chyba a konečný stav nepřepíše', async () => {
    const fake = cancellableSource(job('a', 'running', '2026-08-01T10:00:00.000Z'));
    registerJobSource(fake.source);
    const first = await cancelJob(ctx, 'import', 'a', assertAll);
    expect(first).toMatchObject({ status: 'done', outcome: 'cancelling' });

    const second = await cancelJob(ctx, 'import', 'a', assertAll);
    expect(second).toMatchObject({ status: 'done', outcome: 'already_cancelled' });
    expect(fake.current().status).toBe('cancelled');
  });

  it('úloha, která mezitím doběhla, se zpětně zrušit nedá', async () => {
    const fake = cancellableSource(job('a', 'completed', '2026-08-01T10:00:00.000Z'));
    registerJobSource(fake.source);
    const result = await cancelJob(ctx, 'import', 'a', assertAll);
    expect(result).toMatchObject({ status: 'done', outcome: 'already_finished' });
    // Doména se nevolá vůbec: stav je koncový a přepsat se nesmí.
    expect(fake.calls()).toBe(0);
    expect(fake.current().status).toBe('completed');
  });

  it('odpověď nese úlohu PO zásahu, ne tu před ním', async () => {
    const fake = cancellableSource(job('a', 'running', '2026-08-01T10:00:00.000Z'));
    registerJobSource(fake.source);
    const result = await cancelJob(ctx, 'import', 'a', assertAll);
    expect(result).toMatchObject({
      status: 'done',
      // `stopping`, ne „zastaveno": běh se zastaví až u nejbližší kontroly.
      job: { status: 'cancelled', cancellable: false, stopping: true },
    });
  });
});
