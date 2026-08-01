/**
 * Rozhodnutí D14: dotaz, který je ve specifikaci normativní, musí mít test proti
 * skutečnému Postgresu, i kdyby ověřoval jen to, že projde plánovačem. Kontrola
 * čtením nespustitelné SQL neodhalí.
 *
 * Plán tenhle soubor jmenoval v kroku 4 úkolu 11 (`test:db -- audience`), ale jeho
 * obsah nenapsal. Testuje se to, na čem stojí náhled: přesný počet, ořez vzorku
 * a záchranná síť s odhadem po vypršení stropu doby běhu.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedContacts, seedList, type TestWorkspace } from '../../test/harness';
import { countWithTimeout, sampleAudience } from '../audience';

describe('nahled publika proti databazi', () => {
  let ctx: TestWorkspace;
  beforeAll(async () => {
    ctx = await withTestWorkspace();
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 12, list });
  });

  it('presny pocet projde planovacem a vraci exact true', async () => {
    const r = await countWithTimeout(ctx.workspace, { sql: 'true', params: [] }, 5_000);
    expect(r.count).toBe(12);
    expect(r.exact).toBe(true);
  });

  it('vyraz publika se dosazuje jako parametr, ne jako text', async () => {
    const r = await countWithTimeout(
      ctx.workspace,
      { sql: 'c.status = $2', params: ['unsubscribed'] },
      5_000,
    );
    expect(r.count).toBe(0);
  });

  it('vzorek respektuje limit a vraci sloupce, ktere ceka nahled', async () => {
    const rows = await sampleAudience(ctx.workspace, { sql: 'true', params: [] }, 5);
    expect(rows).toHaveLength(5);
    expect(Object.keys(rows[0]!).sort()).toEqual(['contact_id', 'email', 'first_name']);
  });

  it('po vyprseni stropu vraci odhad a exact false, ne chybu', async () => {
    // Strop 1 ms spolehlive vyprsi. Zachranna sit musi otevrit NOVOU transakci,
    // protoze puvodni je po query_canceled ve stavu aborted.
    const r = await countWithTimeout(
      ctx.workspace,
      { sql: '(SELECT count(*) FROM generate_series(1, 20000000)) >= 0', params: [] },
      1,
    );
    expect(r.exact).toBe(false);
    expect(r.count).toBeGreaterThanOrEqual(0);
  });
});
