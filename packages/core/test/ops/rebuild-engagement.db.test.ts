import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { rebuildEngagement } from '../../src/ops/rebuild-engagement';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  ({ workspaceId } = await pg.seedMinimalInstallation({ contacts: 25 }));
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('rebuildEngagement', () => {
  // ---------------------------------------------------------------------------
  // ROZHRANÍ I→P10.1. Kontraktní test, ne test chování: hlídá, že dávkovač P16
  // má co volat a že se ta funkce nepřestěhovala z barelu `@mlain/core/tracking`.
  //
  // Vzorec sám je v `src/tracking/repo/contact-engagement.repo.ts` a testuje ho
  // `test/tracking/contact-engagement.db.test.ts`. Tady se schválně netestuje
  // podruhé: podle rozhodnutí A8 je kopie vzorce zakázaná a kopie testu by
  // svedla ke kopii vzorce.
  // ---------------------------------------------------------------------------
  it('přepočet z @mlain/core/tracking existuje (rozhraní I→P10.1)', async () => {
    const tracking = (await import('../../src/tracking/index')) as Record<string, unknown>;
    expect(typeof tracking['recomputeContactEngagement']).toBe('function');
  });

  it('u neznámého projektu skončí chybou, ne tichým nulovým během', async () => {
    await expect(
      rebuildEngagement({
        adminUrl: pg.ownerUrl,
        workspaceId: '00000000-0000-7000-8000-000000000000',
        batchSize: 10,
      }),
    ).rejects.toThrow(/projekt/i);
  });

  it('chybějící přepočet hlásí jménem, ne obecným pádem', async () => {
    // Kdyby si P16 vzorec opsal, tenhle test by neexistoval a rozchod dvou
    // implementací by se projevil až na číslech reportu.
    const err = await rebuildEngagement({
      adminUrl: pg.ownerUrl,
      workspaceId,
      batchSize: 10,
    }).catch((e: Error) => e);
    if (err instanceof Error && /recomputeContactEngagement/.test(err.message)) {
      expect(err.message).toContain('I→P10.1');
    } else {
      // Část 5 přepočet dodala, takže dávkování opravdu proběhlo.
      expect(err).not.toBeInstanceOf(Error);
    }
  });
});
