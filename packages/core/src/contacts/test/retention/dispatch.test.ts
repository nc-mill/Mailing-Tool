import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  retentionDispatchHandler,
  type RetentionDispatchDeps,
} from '../../jobs/retention-dispatch';
import { RETENTION_SPREAD_SECONDS, retentionOffsetSeconds } from '../../jobs/retention-offset';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function deps(overrides: Partial<RetentionDispatchDeps> = {}): {
  deps: RetentionDispatchDeps;
  enqueued: Array<{ workspaceId: string; startAfterSeconds: number }>;
} {
  const enqueued: Array<{ workspaceId: string; startAfterSeconds: number }> = [];
  return {
    enqueued,
    deps: {
      listWorkspaces: async () => [A, B],
      enqueueRun: async (input) => {
        enqueued.push(input);
      },
      ...overrides,
    },
  };
}

describe('dispečer denní retence', () => {
  it('REGRESE: cronový tik rozešle úlohu KAŽDÉMU projektu', async () => {
    // Tohle je ta vada, kvůli které dispečer vznikl. `registerQueues` plánuje
    // cron s prázdným nákladem a retence běží nad jedním projektem, takže
    // denní běh nemazal nic. Kdyby se dispečer vypustil, zůstane pole prázdné.
    const { deps: d, enqueued } = deps();
    const result = await retentionDispatchHandler(d);

    expect(enqueued.map((job) => job.workspaceId)).toEqual([A, B]);
    expect(result).toEqual({ workspaces: 2, dispatched: 2, failed: 0 });
  });

  it('náklad nese workspaceId, tedy přesně to, co obsluha běhu vyžaduje', async () => {
    const { deps: d, enqueued } = deps();
    await retentionDispatchHandler(d);
    for (const job of enqueued) {
      expect(typeof job.workspaceId).toBe('string');
      expect(job.workspaceId.length).toBeGreaterThan(0);
    }
  });

  it('PÁD JEDNOHO PROJEKTU nezastaví ostatní a úloha přesto SELŽE', async () => {
    // Kdyby se cyklus zastavil na první chybě, sebral by jeden projekt retenci
    // všem za sebou. Kdyby chybu spolkl, tichý úspěch nad polovinou instalace
    // by se nedozvěděl nikdo.
    const enqueueRun = vi.fn(async (input: { workspaceId: string }) => {
      if (input.workspaceId === B) throw new Error('deadlock detected');
    });
    const { deps: d } = deps({ listWorkspaces: async () => [A, B, C], enqueueRun });

    await expect(retentionDispatchHandler(d)).rejects.toThrow(/nezařadil 1 z 3 projektů/);
    expect(enqueueRun).toHaveBeenCalledTimes(3);
    expect(enqueueRun.mock.calls.map((call) => call[0].workspaceId)).toEqual([A, B, C]);
  });

  it('chybějící role pro výčet projektů úlohu SHODÍ, nepřeskočí ji tiše', async () => {
    const { deps: d } = deps({
      listWorkspaces: async () => {
        throw new Error('DATABASE_URL_MAINTENANCE není nastavená');
      },
    });
    await expect(retentionDispatchHandler(d)).rejects.toThrow(/DATABASE_URL_MAINTENANCE/);
  });

  it('instalace bez projektů proběhne bez chyby', async () => {
    const { deps: d, enqueued } = deps({ listWorkspaces: async () => [] });
    await expect(retentionDispatchHandler(d)).resolves.toEqual({
      workspaces: 0,
      dispatched: 0,
      failed: 0,
    });
    expect(enqueued).toEqual([]);
  });
});

describe('rozprostření běhů v čase', () => {
  it('offset je deterministický, takže projekt má svůj čas každou noc týž', () => {
    expect(retentionOffsetSeconds(A)).toBe(retentionOffsetSeconds(A));
    expect(retentionOffsetSeconds(A)).not.toBe(retentionOffsetSeconds(B));
  });

  it('offset se vejde do okna', () => {
    for (const id of [A, B, C]) {
      const offset = retentionOffsetSeconds(id);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(RETENTION_SPREAD_SECONDS);
    }
  });

  it('sto projektů se rozloží, nespustí se v jednu sekundu', () => {
    const offsets = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      offsets.add(retentionOffsetSeconds(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
    }
    // Kolizi v hashi nezakazujeme, ale sto projektů v jedné sekundě je vada.
    expect(offsets.size).toBeGreaterThan(90);
  });

  it('nulová šířka okna vypne rozprostření, pro testy a malé instalace', () => {
    expect(retentionOffsetSeconds(A, 0)).toBe(0);
  });

  it('recept offsetu se nemění: pevné hodnoty pro pevná id', () => {
    // Naměřeno spuštěním PŘED přesunem výpočtu do vlastního modulu a zapsáno,
    // aby se dalo doložit, že přesun čísla nezměnil. Změna receptu (jiný hash,
    // jiný počet bitů, jiné okno) posune noční okno VŠEM projektům naráz, takže
    // se nesmí stát mimochodem.
    expect(retentionOffsetSeconds(A)).toBe(7125);
    expect(retentionOffsetSeconds(B)).toBe(9436);
    expect(retentionOffsetSeconds(C)).toBe(129);
    expect(retentionOffsetSeconds('019fc29d-4987-74cf-bcaa-47e69191774b')).toBe(10562);
  });

  it('modul s výpočtem NESAHÁ do databáze, a proto smí brát holé workspaceId', () => {
    // Tohle je premisa, na které stojí výjimka z pravidla v
    // `identity/scope.test.ts`. Podmínka je opsaná z jeho funkce
    // `touchesDatabase`: kdo sem přidá dotaz, shodí obojí, tenhle test i to
    // pravidlo, a to je správně.
    const source = readFileSync(
      resolve(import.meta.dirname, '../../jobs/retention-offset.ts'),
      'utf8',
    );
    expect(/from '(drizzle-orm|@mlain\/db)/.test(source)).toBe(false);
    expect(/from '[^']*\/tx'/.test(source)).toBe(false);
  });
});
