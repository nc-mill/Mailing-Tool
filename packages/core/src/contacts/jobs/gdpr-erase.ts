import { createSystemContext } from '../../identity/context';
import { anonymizeContact, purgeContact } from '../gdpr/erase';
import { completeGdprRequest, getGdprRequest } from '../repo/gdpr';

export type GdprErasePayload = { workspaceId: string; requestId: string };

/**
 * Provedení žádosti o výmaz. Režim rozhoduje řádek žádosti: `anonymize` je výchozí,
 * `purge` je vyhrazený vlastníkovi projektu.
 *
 * Idempotence: každý krok je podmíněný na `anonymized_at IS NULL`, respektive na
 * existenci kontaktu, takže druhý běh po pádu workeru je bez efektu.
 */
export async function runGdprErase(
  payload: GdprErasePayload,
): Promise<{ mode: 'anonymize' | 'purge'; skipped: boolean }> {
  const ctx = createSystemContext(payload.workspaceId, 'gdpr.erase');
  const request = await getGdprRequest(ctx, payload.requestId);

  if (request === null || request.type !== 'erasure' || request.contactId === null) {
    return { mode: 'anonymize', skipped: true };
  }

  const mode = request.mode ?? 'anonymize';
  if (mode === 'purge') {
    await purgeContact(ctx, request.contactId, payload.requestId);
    return { mode, skipped: false };
  }

  const result = await anonymizeContact(ctx, request.contactId);
  if (!result.alreadyAnonymized) {
    await completeGdprRequest(ctx, payload.requestId, { contacts: 1, mode });
  }
  return { mode, skipped: result.alreadyAnonymized };
}
