import type { WorkspaceContext } from '../../tx';
import { anonymizeMessages as repoAnonymize } from '../repo/outbox';

/** Volá část 2 při výmazu kontaktu, viz její požadavek R2.5. */
export async function anonymizeMessages(ctx: WorkspaceContext, contactId: string): Promise<void> {
  await repoAnonymize(ctx, contactId);
}
