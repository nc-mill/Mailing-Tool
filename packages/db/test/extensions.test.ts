import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('rozšíření', () => {
  it('citext, pg_trgm a btree_gin jsou nainstalované', async () => {
    const { rows } = await h
      .as('mlain_app')
      .query<{ extname: string }>('SELECT extname FROM pg_extension ORDER BY extname');
    const names = rows.map((r) => r.extname);
    expect(names).toContain('citext');
    expect(names).toContain('pg_trgm');
    expect(names).toContain('btree_gin');
  });
});
