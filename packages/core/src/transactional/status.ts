import { and, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import { withWorkspace } from '../tx';

/**
 * Stav jedné transakční zprávy pro `GET /api/v1/transactional/{id}`.
 *
 * PROČ TO VŮBEC EXISTUJE. `POST /transactional` vrací `202` a stav `queued`,
 * protože zprávu odesílá až sender, ne ten požadavek. Bez čtecí cesty se
 * zákazník nedozvěděl, jestli e-mail nakonec odešel, jinak než odchozím
 * webhookem, a ty pro doručení, odraz ani stížnost zatím nevznikají
 * (`tracking/jobs/process-engagement.ts` posílá jen `message.opened`
 * a `message.clicked`). Průzkum přitom tuhle cestu popisoval, jako by byla,
 * takže produkt něco sliboval a nedodával.
 *
 * JEN `kind = 'transactional'`, a není to kosmetické omezení. Přes `messages`
 * jde i rozesílka kampaní a testovací odeslání; kdyby se filtr vynechal, stal
 * by se z klíče s `transactional:send` nástroj na čtení stavu zpráv celé
 * kampaně včetně adresy příjemce. Cizí `id` proto vypadá stejně jako
 * neexistující, tedy `404`.
 *
 * ČTE SE `withWorkspace`, stejně jako ostatní čtecí cesty domény.
 * `withReadOnly` má vlastní pool a je určený pro dynamicky sestavené SQL
 * (náhled segmentu); tenhle dotaz je statický a jedním spojením navíc by se
 * platilo za nic.
 *
 * POZOR NA ROZDĚLENÍ TABULKY. `messages` je dělená podle `created_at`
 * a hledá se výhradně podle `id`, takže dotaz projde všechny oddíly. Pro
 * jednotlivé dohledání stavu je to v pořádku; kdyby odsud jednou vznikl výpis,
 * musí dostat i časové okno, jinak z toho bude scan celé historie.
 *
 * `messages.error_detail` se ven SCHVÁLNĚ NEDÁVÁ, přestože ve sloupci je.
 * `FormatErrorDetail` v senderovi do něj skládá i identifikátor odesílací
 * instance (`attempt 2, sender-7`), tedy vnitřní topologii provozu, se kterou
 * volající stejně nic neudělá. Jednat se dá podle `error_code`, a ten je
 * z uzavřeného registru, takže se na něj smí spolehnout kód na druhé straně.
 */
export type TransactionalStatus = {
  messageId: string;
  /** Sjednocený slovník pro zákazníka, ne interní stav řádku. Viz `toPublicStatus`. */
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  contactId: string;
  campaignId: string | null;
  createdAt: Date;
  sentAt: Date | null;
  attempts: number;
  errorCode: string | null;
  providerMessageId: string | null;
};

/**
 * Překlad stavu outboxu na slovník, kterému rozumí aplikace zákazníka.
 *
 * `claimed` znamená, že si řádek vzal odesílací proces. Je to vnitřní krok
 * mezi „ve frontě" a „odesláno", se kterým volající nemůže nic udělat a který
 * se navíc vrací zpátky na `pending`, když si zprávu nikdo nedokončí. Ven jde
 * proto jako `queued`, tedy stejným slovem, jaké vrátilo odeslání.
 */
export function toPublicStatus(status: string): TransactionalStatus['status'] {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'queued';
  }
}

export async function findTransactionalStatus(
  ctx: WorkspaceContext,
  messageId: string,
): Promise<TransactionalStatus | null> {
  return withWorkspace(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.messages.id,
        status: schema.messages.status,
        contactId: schema.messages.contactId,
        campaignId: schema.messages.campaignId,
        createdAt: schema.messages.createdAt,
        sentAt: schema.messages.sentAt,
        attempts: schema.messages.attempts,
        errorCode: schema.messages.errorCode,
        providerMessageId: schema.messages.providerMessageId,
      })
      .from(schema.messages)
      .where(
        and(
          wsEq(ctx, schema.messages),
          eq(schema.messages.id, messageId),
          eq(schema.messages.kind, 'transactional'),
        ),
      )
      .limit(1);
    if (row === undefined) return null;

    return {
      messageId: row.id,
      status: toPublicStatus(row.status),
      contactId: row.contactId,
      campaignId: row.campaignId,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      attempts: row.attempts,
      errorCode: row.errorCode,
      providerMessageId: row.providerMessageId,
    };
  });
}
