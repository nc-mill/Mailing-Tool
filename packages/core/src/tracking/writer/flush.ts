import { v7 as uuidv7 } from 'uuid';
import type { BufferedClick } from '../click/handle-click';
import type { BufferedOpen } from '../open/handle-open';
import { insertMessageEvents, type MessageEventInsert } from '../repo/message-events.repo';
import { lookupMessage } from '../tokens/message-lookup';

export type BufferedTrackingEvent = BufferedOpen | BufferedClick;

/**
 * Vyprázdnění bufferu otevření a prokliků do `message_events`.
 *
 * BYDLÍ TADY, NE V `apps/web`. Do téhle chvíle to byla lokální funkce
 * v `apps/web/src/app/t/tracking-runtime.ts`, takže jediný kus kódu, který
 * převádí naměřenou událost na řádek v databázi, nešel otestovat jinak než
 * spuštěním celé aplikace. Přesně na tomhle článku se řetěz měření trhal
 * a nikdo to nemohl chytit testem. Aplikace teď volá tuhle funkci a test
 * volá tutéž.
 *
 * Zařazení navazující úlohy `tracking.process_engagement` dělá
 * `insertMessageEvents`, a to ve stejné transakci jako zápis událostí.
 */
export async function flushTrackingEvents(
  batch: readonly BufferedTrackingEvent[],
): Promise<string[]> {
  const rows: MessageEventInsert[] = [];

  for (const item of batch) {
    const message = await lookupMessage({
      workspaceId: item.workspaceId,
      messageId: item.messageId,
      messageCreatedAt: item.messageCreatedAt,
    });
    // Nedohledaná zpráva je porušení invariantu I1. Čítač zvýšil lookupMessage,
    // událost se zahodí: bez kampaně ji není kam zařadit.
    if (message === null) continue;

    rows.push({
      id: uuidv7(),
      workspaceId: item.workspaceId,
      messageId: item.messageId,
      messageCreatedAt: message.createdAt,
      campaignId: message.campaignId,
      contactId: message.contactId,
      type: item.kind === 'open' ? 'open' : 'click',
      subtype: item.kind === 'open' ? item.openClass : item.clickClass,
      ts: item.occurredAt,
      linkId: item.kind === 'click' ? item.linkId : null,
      // IP je vstupem pravidla 6 klasifikace prokliku, které se dopočítává až
      // v jobu. Bez ní by skener, který otevřel tři odkazy téže zprávy z jedné
      // adresy, prošel jako člověk.
      metadata:
        item.kind === 'click'
          ? { link_position: item.linkPosition, ...(item.ip === null ? {} : { ip: item.ip }) }
          : {},
    });
  }

  return insertMessageEvents(rows);
}
