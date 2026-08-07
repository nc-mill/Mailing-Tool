import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSuppression,
  seedMessages,
  withTestWorkspace,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { rawSql } from '../../repo/raw-sql';
import { reconcileHandler } from '../reconcile';
import { systemReconcileDeps } from '../system-deps';

/**
 * DŮKAZ, že úloha `outbox.reconcile` doopravdy doběhne.
 *
 * Fronta padala každou minutu od 3. srpna, přes čtyři tisíce selhání, a důvod
 * byl jen ten, že se v poznámce u továrny tvrdilo, že se druhá polovina
 * závislostí složit nedá. Šlo to: `reconcilePending` pracuje nad celým
 * projektem a přesně tvar `reconcile(workspaceId)` má.
 *
 * Test skládá závislosti PRODUKČNÍ továrnou, ne ručně. Ruční složení by ověřilo
 * jen `reconcileHandler`, tedy tu část, která nikdy rozbitá nebyla.
 */
describe('outbox.reconcile se složí a doběhne', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('úloha nad projektem s blokovanou adresou zruší připravenou zprávu', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual' });

    const deps = systemReconcileDeps();
    // Sken projektů pod rolí `mlain_maintenance` vrací i cizí projekty z jiných
    // souběžných testů; zúžení na ten svůj drží tvrzení o počtu přesné.
    const log = vi.fn();
    const result = await reconcileHandler({
      ...deps,
      listWorkspaces: async () => [ctx.workspaceId],
      log,
    });

    expect(result.revoked).toBe(1);
    // Když záchytná cesta něco zrušila, musí to být v logu: znamená to, že
    // okamžitá cesta minula, a to se jinak nedozví nikdo.
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('zachytna cesta'),
      expect.objectContaining({ workspaceId: ctx.workspaceId, revoked: 1 }),
    );
  });

  /**
   * Úloha musí být zapojená na `reconcilePending`, ne na `reconcileSuppressed`.
   * Bez tohohle testu by přepojení zpátky na blokované adresy prošlo zeleně:
   * test výš i test o kus níž si vystačí se suppression a odhlášeného člověka
   * by nikdo neochránil.
   */
  it('úloha kryje i odhlášeného, ne jenom blokované adresy', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`UPDATE contacts SET status = 'unsubscribed' WHERE id = $1 AND workspace_id = $2`, [
          contactId,
          ctx.workspaceId,
        ]),
      ),
    );

    const result = await reconcileHandler({
      ...systemReconcileDeps(),
      listWorkspaces: async () => [ctx.workspaceId],
      log: vi.fn(),
    });

    expect(result.revoked).toBe(1);
  });

  it('bez čeho zrušit doběhne v tichosti, to je správný stav pojistky', async () => {
    await seedMessages(ctx, { statuses: ['pending'] });

    const log = vi.fn();
    const result = await reconcileHandler({
      ...systemReconcileDeps(),
      listWorkspaces: async () => [ctx.workspaceId],
      log,
    });

    expect(result).toEqual({ revoked: 0 });
    expect(log).not.toHaveBeenCalled();
  });

  it('výčet projektů pod rolí mlain_maintenance vrátí i tenhle projekt', async () => {
    await expect(systemReconcileDeps().listWorkspaces()).resolves.toContain(ctx.workspaceId);
  });
});
