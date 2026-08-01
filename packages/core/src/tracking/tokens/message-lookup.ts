import { trackingMetrics } from '../metrics';
import { selectMessageExact, selectMessageNear, type MessageRow } from '../repo/messages.repo';

export type LookupInput = {
  workspaceId: string;
  messageId: string;
  /** Unixové sekundy z tokenu. Lokátor partition. */
  messageCreatedAt: number;
};

/**
 * Chování podle 3.1.2.2 části 5.
 * 1. rovnost, 2. okno jedné sekundy, 3. null plus čítač. Krok 4 zní: NIKDY dotaz
 * bez podmínky na created_at. Růst čítače je alert, protože znamená porušený invariant I1.
 */
export async function lookupMessage(input: LookupInput): Promise<MessageRow | null> {
  const key = {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    createdAtSeconds: input.messageCreatedAt,
  };

  const exact = await selectMessageExact(key);
  if (exact !== null) return exact;

  const near = await selectMessageNear(key);
  if (near !== null) return near;

  trackingMetrics.messageLookupMiss.inc();
  return null;
}
