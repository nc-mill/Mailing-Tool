import { and, inArray, isNull } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { createSystemContext } from '../../identity/context';
import { wsEq } from '../../identity/scope';
import { withWorkspace, type Tx } from '../../tx';
import { segmentsLogger } from '../logging';

export const MARK_INVALID_QUEUE = 'segments.mark_invalid';

export type MarkInvalidPayload = {
  workspaceId: string;
  segmentIds?: readonly string[];
  errorCode?: string;
  /** Klíč smazaného pole. Nese se jen do logu, dotaz podle něj nejde vést. */
  fieldKey?: string;
};

export type MarkInvalidResult = { invalidated: string[] };

/**
 * Výchozí kód podle části 2, tabulka v 4.2: smazání vlastního pole nechá
 * segmenty, které ho používaly, ve stavu `error` s `segment_field_missing`.
 */
const DEFAULT_ERROR_CODE = 'segment_field_missing';

/**
 * Obsluha fronty `segments.mark_invalid`.
 *
 * Producent je `deleteContactField` v doméně kontaktů: smazané vlastní pole
 * zůstane v definicích segmentů, které ho četly, takže jejich dotaz od téhle
 * chvíle nedává smysl. Segment se ale NESMAŽE ani neuloží prázdný, protože
 * definici napsal uživatel a jediné, co je špatně, je chybějící pole; proto se
 * jen označí a čeká na opravu.
 *
 * Seznam segmentů si obsluha ZÁMĚRNĚ nedopočítává z `field_key`: kdo pole mazal,
 * ten ho spočítal ještě před `DELETE`, kdy pole existovalo. Po smazání už by
 * stejný dotaz nenašel nic a job by tiše neudělal nic.
 *
 * Idempotence: druhý běh přepíše týž stav týmiž hodnotami.
 */
export const handler = async (job: { data: MarkInvalidPayload }): Promise<MarkInvalidResult> => {
  const { workspaceId, segmentIds, errorCode, fieldKey } = job.data;
  const ids = [...new Set(segmentIds ?? [])];
  if (ids.length === 0) {
    // Smazání pole, které v žádném segmentu nebylo, je běžný případ, ne chyba.
    // `inArray` s prázdným polem by navíc vyrobilo dotaz bez smyslu.
    return { invalidated: [] };
  }

  const ctx = createSystemContext(workspaceId, MARK_INVALID_QUEUE);

  return withWorkspace(ctx, async (tx: Tx) => {
    const rows = (await tx
      .update(segments)
      .set({ recomputeState: 'error', lastErrorCode: errorCode ?? DEFAULT_ERROR_CODE })
      .where(and(wsEq(ctx, segments), inArray(segments.id, ids), isNull(segments.deletedAt)))
      .returning({ id: segments.id })) as { id: string }[];

    const invalidated = rows.map((row) => row.id);
    segmentsLogger().info(
      {
        workspaceId,
        fieldKey: fieldKey ?? null,
        requested: ids.length,
        invalidated: invalidated.length,
      },
      'segments.mark_invalid finished',
    );
    return { invalidated };
  });
};
