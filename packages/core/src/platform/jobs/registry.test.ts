import { beforeEach, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import {
  clearJobSources,
  getJob,
  listJobs,
  registerJobSource,
  registeredJobKinds,
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
