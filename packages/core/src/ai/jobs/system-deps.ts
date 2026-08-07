import { loadConfig } from '../../config/index';
import { createSystemContext } from '../../identity/context';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { aiLogger } from '../logging';
import { withWorkspace } from '../../tx';
import { deleteConversationsOlderThan } from '../repo';
import {
  cleanupConversations,
  type CleanupDeps,
  type CleanupResult,
} from './cleanup-conversations';

/**
 * Kompoziční kořen úlohy `ai.cleanup_conversations`.
 *
 * PROČ TO NEBYLO. `cleanupConversations` existovalo i s testy, jenže obsluha
 * fronty byla vedená jako `needsDependencies('ai.cleanup_conversations',
 * 'CleanupDeps')`, protože továrnu jejích závislostí nikdo nenapsal. Úloha tedy
 * každou noc spadla se stejnou hláškou a konverzace s texty, které do nich lidé
 * napsali, zůstávaly v databázi i ve všech zálohách navždy. To je přesně to
 * uchovávání osobních údajů, které měla proměnná `AI_CONVERSATION_RETENTION_DAYS`
 * omezovat.
 *
 * Skladba je dvoutaktní, jako u ostatních systémových úloh (podrobně
 * v `campaigns/jobs/system-deps.ts`): výčet projektů čte role
 * `mlain_maintenance`, vlastní mazání běží pod `mlain_app` v kontextu jednoho
 * projektu, takže na `ai_conversations` dopadá RLS.
 *
 * Rozhodnutí „mazat se nemá" (`AI_CONVERSATION_RETENTION_DAYS = 0`) zůstává celé
 * v `cleanupConversations`, kde má test. Tahle továrna ho neopakuje: druhá kopie
 * té podmínky je druhé místo, kde se dá splést.
 */
export function systemCleanupConversationsDeps(): CleanupDeps {
  const log = aiLogger();
  const job = 'ai.cleanup_conversations';

  return {
    deleteConversationsOlderThan: async (cutoff) => {
      let deleted = 0;
      for (const workspaceId of await listWorkspaceIds()) {
        const ctx = createSystemContext(workspaceId, job);
        try {
          deleted += await withWorkspace(ctx, (tx) => deleteConversationsOlderThan(tx, cutoff));
        } catch (error) {
          /*
           * Pád jednoho projektu nesmí zastavit ostatní. Retence je noční úklid,
           * co se neuklidí dnes, se uklidí zítra; zastavit se na prvním projektu
           * by ale znamenalo, že se ke zbytku instalace úklid nedostane nikdy.
           */
          log.error(
            {
              job,
              workspace_id: workspaceId,
              err: error instanceof Error ? error.message : String(error),
            },
            'retence konverzací v projektu selhala, pokračuje se dalším',
          );
        }
      }
      return deleted;
    },
  };
}

/** Obsluha fronty `ai.cleanup_conversations`. Cron, prázdný náklad. */
export async function cleanupConversationsJob(): Promise<CleanupResult> {
  return cleanupConversations(
    { retentionDays: loadConfig().AI_CONVERSATION_RETENTION_DAYS, now: new Date() },
    systemCleanupConversationsDeps(),
  );
}
