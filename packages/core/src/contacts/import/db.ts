import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';

/**
 * Jediné místo importu, které se dotýká klienta databáze. Kdyby P03 pojmenoval
 * transakční primitivum jinak, mění se jen tenhle soubor.
 */
export function inWorkspaceTx<T>(ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspace(ctx, fn);
}
