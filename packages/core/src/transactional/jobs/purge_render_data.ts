import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace, type Tx } from '../../tx';

/**
 * Vynulování `render_data` u ODESLANÝCH transakčních zpráv.
 *
 * PROČ TENHLE JOB EXISTUJE. `messages.render_data` transakční zprávy nese
 * hodnoty předané při volání API, tedy typicky **odkaz na reset hesla
 * s jednorázovým tokenem**. To je jiná třída údaje než personalizace kampaně:
 * není to jméno v oslovení, je to přihlašovací pověření s omezenou platností.
 *
 * A dnes by tam leželo NAVĚKY. Retence zpráv v produktu není „dlouhá", ona
 * neexistuje:
 *
 *  - `retention.drop_message_partitions` je v registru front, ale obsluhu nemá,
 *  - `dropPartitionsBefore()` v `packages/db/src/partitions.ts` nemá volajícího,
 *  - `MESSAGE_RETENTION_DAYS` se v běhovém kódu nečte vůbec.
 *
 * Jediné, co dnes `render_data` smaže, je výmaz konkrétního kontaktu podle
 * článku 17 (`gdpr.sever_links`). Na to se u tokenu spoléhat nedá.
 *
 * ROZSAH JE ÚZKÝ SCHVÁLNĚ. Job se dotýká VÝHRADNĚ zpráv druhu `transactional`.
 * Obecná retence outboxu je samostatná práce a tenhle job ji nenahrazuje ani
 * nepředstírá; kampaňová a testovací zpráva zůstávají netknuté.
 *
 * PROČ AŽ PO ODSTUPU, NE HNED PO ODESLÁNÍ. Data musí přežít poslední pokus
 * o doručení i rekonciliaci: zpráva se může vrátit z `failed` zpět do fronty
 * a při dalším pokusu se renderuje znovu z týchž dat. Vynulovat je hned po
 * `sent_at` by znamenalo, že opakované odeslání pošle prázdný e-mail.
 * Odstup 24 hodin je s velkou rezervou za posledním pokusem (výchozí
 * `SENDER_MAX_ATTEMPTS` je 5 a strop backoffu 1 hodina).
 *
 * PROČ TO BĚŽÍ PO PROJEKTECH, ne jedním příkazem přes celou tabulku. Je to
 * závazný dvoutaktní postup a přeskočit ho nejde: `registerQueues` plánuje
 * každý cron s PRÁZDNÝM nákladem, takže si job projekty musí najít sám. Sken
 * pod rolí `mlain_maintenance` vrátí POUZE ID projektů, veškerý zápis běží pod
 * `mlain_app` v systémovém kontextu jednoho projektu, takže na něj dopadá RLS
 * stejně jako na požadavek z API.
 *
 * Jediný `UPDATE` bez kontextu projektu by NESELHAL, jen by zasáhl NULA ŘÁDKŮ
 * a job by hlásil úspěch. Přesně tahle vada už v tomhle repozitáři byla
 * u `platform.purge_workspaces` a stála za to, aby se u ní napsal odstavec.
 * Role `mlain_maintenance` navíc na `messages` nemá ani grant, ani politiku,
 * takže obejít RLS tudy by znamenalo migraci a rozšíření práv.
 *
 * CO SE STANE, KDYŽ JOB NEBĚŽÍ. Nic nespadne a nic se nerozbije: `render_data`
 * prostě zůstane v databázi, tedy přesně tak, jak se to chová dnes u všech
 * zpráv. Je to čistě ochranné opatření, ne součást odesílací cesty. Bez
 * `DATABASE_URL_MAINTENANCE` skončí `listWorkspaceIds()` výjimkou s vysvětlením
 * a úloha spadne, což je správně: prázdný seznam by ji nechal skončit úspěchem,
 * přestože by neuklidila nic.
 */

/** Po kolika hodinách od odeslání se data zahazují. */
export const TRANSACTIONAL_RENDER_DATA_TTL_HOURS = 24;

/** Kolik řádků nejvýš za jeden projekt a běh. Dávka nemá držet dlouhý zámek. */
const BATCH_SIZE = 5000;

export async function purgeTransactionalRenderData(): Promise<{
  workspaces: number;
  messages: number;
}> {
  const workspaceIds = await listWorkspaceIds();
  let messages = 0;
  for (const workspaceId of workspaceIds) {
    const ctx = createSystemContext(workspaceId, 'transactional.purge_render_data');
    messages += await withWorkspace(ctx, (tx) => purgeInWorkspace(tx, workspaceId));
  }
  return { workspaces: workspaceIds.length, messages };
}

async function purgeInWorkspace(tx: Tx, workspaceId: string): Promise<number> {
  /**
   * Podmínka `render_data <> '{}'` je to, co dělá job idempotentním: druhý běh
   * už nemá co přepisovat, takže se každou hodinu neprovádí prázdný zápis přes
   * celou historii odeslané transakční pošty.
   */
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH due AS (
      SELECT id, created_at
        FROM messages
       WHERE workspace_id = ${workspaceId}::uuid
         AND kind = 'transactional'
         AND status = 'sent'
         AND sent_at < now() - make_interval(hours => ${TRANSACTIONAL_RENDER_DATA_TTL_HOURS})
         AND render_data <> '{}'::jsonb
       ORDER BY sent_at
       LIMIT ${BATCH_SIZE}
    )
    UPDATE messages m
       SET render_data = '{}'::jsonb,
           updated_at = now()
      FROM due
     WHERE m.id = due.id AND m.created_at = due.created_at
    RETURNING m.id
  `);
  return rows.length;
}

/** Vstupní bod fronty. Vrací počet vyčištěných zpráv pro log workeru. */
export async function handler(): Promise<number> {
  const result = await purgeTransactionalRenderData();
  return result.messages;
}
