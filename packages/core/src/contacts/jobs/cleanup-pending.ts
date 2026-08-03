import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace } from '../../tx';
import { BULK_BATCH_SIZE } from '../constants';
import { getHandler } from '../retention/registry';
// Import kvůli vedlejšímu efektu: soubor registruje handlery retence, mezi nimi
// `unconfirmed_subscriptions`, na kterém stojí druhá půlka tohohle úklidu.
import '../retention/handlers';
import { loadRetentionPolicies } from './retention-run';

export type CleanupPendingResult = {
  workspaces: number;
  /** Vypršelé, nespotřebované potvrzovací tokeny. */
  tokens: number;
  /** Nepotvrzené odběry smazané po uplynutí retenční lhůty. */
  subscriptions: number;
};

/**
 * Noční úklid nepotvrzených přihlášení, jak ho popisuje registr front: "maže
 * nepotvrzené odběry po vypršení TTL potvrzovacího tokenu a po třiceti dnech
 * retence". Jsou to dvě různé lhůty a dvě různé věci, proto dva kroky.
 *
 * KROK 1, VYPRŠELÉ TOKENY. Řádky `subscription_confirmations`, kterým uplynulo
 * `expires_at` a nikdo je nespotřeboval, jsou mrtvé odkazy. Neuklízí je nikdo
 * jiný: retence zná sedm cílů a tabulka potvrzení mezi nimi není, takže by
 * hashe tokenů a k nim IP adresa a user agent žadatele leželi v databázi navždy.
 * SPOTŘEBOVANÉ řádky se NEMAŽOU, a to je v tomhle kroku to podstatné: jsou to
 * důkazy dvojího potvrzení (kdy, z jaké adresy), tedy jediné, čím se dá před
 * dozorovým úřadem doložit, že se člověk přihlásil sám.
 *
 * KROK 2, RETENCE NEPOTVRZENÝCH ODBĚRŮ. Řádek `list_subscriptions` ve stavu
 * `pending`, u kterého uplynula retenční lhůta projektu, se maže. Přechod
 * popisuje stavový automat: událost `cleanup` vede z `pending` na `deleted`
 * s efektem `delete_row`, a z ničeho jiného se `cleanup` dotknout nesmí, jinak
 * by mazal důkazy o odhlášení a stížnostech.
 *
 * Krok 2 si vlastní SQL NEPÍŠE. Volá registrovaný retenční handler cíle
 * `unconfirmed_subscriptions` s politikou z `retention_policies` projektu, tedy
 * TUTÉŽ funkci a TUTÉŽ lhůtu, jakou použije `retention.run`. Druhá kopie by
 * znamenala dvě definice toho, kdy se osobní údaje mažou, a rozešly by se v tichosti.
 * Vypnutá politika (`enabled = false`) se respektuje: projekt, který si retenci
 * vypnul, si ji nesmí nechat provést zadními vrátky přes noční úklid.
 *
 * PŘEKRYV S `retention.run` JE VĚDOMÝ. Tentýž cíl umí smazat i denní retenční běh
 * a při zapojeném dispečeru ho i maže. Krok 2 tu přesto je, protože retenční běh
 * má `retryLimit: 0` a tvrdý strop 30 minut na CELÝ projekt, po kterém cyklus
 * PŘERUŠÍ: u velkého projektu se na sedmý cíl v pořadí nemusí dostat ani jednu
 * noc a poznalo by se to jen podle stavu `partial` v `retention_runs`. Tenhle job
 * dělá jediný cíl, takže se k němu dostane vždycky. Práce se přitom nezdvojuje,
 * jen se dokončí: obojí je DELETE podmíněný na stav a stáří, takže co smazal
 * jeden, druhý už nenajde.
 *
 * PROČ TO BĚŽÍ NAPŘÍČ PROJEKTY. Fronta má cron `55 2 * * *` a `singletonKey`
 * `global`, jenže `registerQueues` plánuje každý cron s PRÁZDNÝM nákladem.
 * Job si proto musí projekty najít sám a aplikační role je vyjmenovat neumí.
 * Postup je ten závazný dvoutaktní: sken pod rolí `mlain_maintenance` vrátí
 * POUZE ID projektů, veškerá další práce běží pod `mlain_app` v systémovém
 * kontextu jednoho projektu, takže na ni dopadá RLS stejně jako na požadavek
 * z API. Bez `DATABASE_URL_MAINTENANCE` skončí `listWorkspaceIds()` výjimkou
 * s vysvětlením, a to je správně: prázdný seznam by úlohu nechal skončit
 * úspěchem, přestože by neuklidila nic.
 *
 * Idempotence: DELETE podmíněný na stav a na stáří, druhý běh nemá co mazat.
 * Přesně to tvrdí `CONTACTS_QUEUES['contacts.cleanup_pending']`.
 *
 * AUDITNÍ ŘÁDEK SE NEPÍŠE, a je to vědomé, ne opomenutí. Mazání nepotvrzených
 * odběrů podle lhůty dělá dnes retence a taky ho neaudituje: jeho záznamem je
 * `retention_runs` plus samotná politika, ne řádek na každý projekt a noc.
 * Audit každé noci u každého projektu by `audit_log` zaplnil událostmi, které
 * nikdo nevyvolal a ve kterých by zaniklo to, co vyvolal člověk.
 */
export async function cleanupPendingSubscriptions(): Promise<CleanupPendingResult> {
  const workspaceIds = await listWorkspaceIds();
  const result: CleanupPendingResult = {
    workspaces: workspaceIds.length,
    tokens: 0,
    subscriptions: 0,
  };

  for (const workspaceId of workspaceIds) {
    const ctx = createSystemContext(workspaceId, 'contacts.cleanup_pending');
    result.tokens += await deleteExpiredConfirmations(ctx);
    result.subscriptions += await deleteRetiredPending(ctx);
  }

  return result;
}

/**
 * Krok 1 po dávkách. Dávkuje se ze stejného důvodu jako u retence: jeden DELETE
 * nad statisíci řádky drží zámky celou dobu běhu a noční úklid nesmí blokovat
 * potvrzení, které v tu chvíli někdo klikne.
 */
async function deleteExpiredConfirmations(ctx: WorkspaceContext): Promise<number> {
  let deleted = 0;
  for (;;) {
    const removed = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        DELETE FROM subscription_confirmations
         WHERE id IN (
           SELECT id FROM subscription_confirmations
            WHERE workspace_id = ${ctx.workspaceId}::uuid
              AND consumed_at IS NULL
              AND expires_at <= now()
            LIMIT ${BULK_BATCH_SIZE}
         )
        RETURNING id
      `);
      return rows.length;
    });
    if (removed === 0) return deleted;
    deleted += removed;
  }
}

/** Krok 2. Lhůtu i mazání vlastní retence, tohle je jen její spuštění mimo noční běh. */
async function deleteRetiredPending(ctx: WorkspaceContext): Promise<number> {
  const policy = (await loadRetentionPolicies(ctx))['unconfirmed_subscriptions'];
  if (!policy.enabled) return 0;

  const handler = getHandler('unconfirmed_subscriptions');
  if (handler === undefined) {
    throw new Error(
      'Retenční handler cíle unconfirmed_subscriptions není registrovaný, takže úklid ' +
        'nepotvrzených odběrů nemá čím mazat. Registruje ho import contacts/retention/handlers; ' +
        'bez něj by job skončil úspěchem a osobní údaje by v databázi zůstaly.',
    );
  }

  const { affected } = await handler({ ctx, policy });
  return affected;
}
