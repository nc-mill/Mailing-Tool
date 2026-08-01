import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedMessages,
  addSuppression,
  anonymizeSuppression,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { reconcileSuppressed } from '../outbox';
import { rawSql } from '../raw-sql';

describe('zachytna cesta outbox.reconcile', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('dotaz projde planovacem i nad prazdnymi tabulkami (lokalni OB-00)', async () => {
    await expect(reconcileSuppressed(ctx.workspace)).resolves.toMatchObject({ revoked: 0 });
  });

  it('primy zapis do suppressions vede do 60 s na skipped se suppressed', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual' });
    const r = await reconcileSuppressed(ctx.workspace);
    expect(r.revoked).toBe(1);
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string }>(
        rawSql(`SELECT status, error_code FROM messages WHERE lower(email) = $1`, [
          email.toLowerCase(),
        ]),
      ),
    );
    expect(rows.rows[0]).toMatchObject({ status: 'skipped', error_code: 'suppressed' });
  });

  it('shoda jen pres otisk take rusi, plaintext uz neexistuje', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'gdpr_erasure' });
    await anonymizeSuppression(ctx, { email });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(1);
  });

  it('mekce odebrana suppression (removed_at) neruší nic', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual', removed: true });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(0);
  });

  it('claimed zprava zustava claimed', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['claimed'] });
    await addSuppression(ctx, { email, reason: 'hard_bounce' });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(0);
  });
});
