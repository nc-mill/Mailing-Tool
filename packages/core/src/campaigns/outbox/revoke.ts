import type { WorkspaceContext } from '../../tx';
import { revokePending, type RevokeReason } from '../repo/outbox';

export type RevokeInput = {
  /** Jeden kontakt, tvar, kterym vola cast 2. */
  contactId?: string;
  /** Davka, preferovana vetev uvnitr teto casti. */
  contactIds?: string[];
  /** Pro pripady, kdy zname jen adresu, typicky pri zpracovani SES udalosti. */
  emails?: string[];
  /**
   * POVINNY, i kdyz smi byt null. Volajici musi vedome rozhodnout o rozsahu.
   * Bez toho vznika ticha ztrata posty: clovek se odhlasi z jednoho newsletteru
   * a prijde i o cekajici zpravy z kampani na uplne jine seznamy, na ktere zustal
   * prihlaseny. Nikdo si toho nevsimne, protoze zpravy skonci jako skipped
   * s verohodnym duvodem.
   */
  listId: string | null;
  reason: RevokeReason;
};

export async function revokePendingMessages(
  ctx: WorkspaceContext,
  input: RevokeInput,
): Promise<{ revoked: number }> {
  const contactIds = input.contactIds ?? (input.contactId ? [input.contactId] : undefined);
  if (!contactIds?.length && !input.emails?.length) return { revoked: 0 };
  return revokePending(ctx, {
    contactIds,
    emails: input.emails,
    listId: input.listId,
    reason: input.reason,
  });
}
