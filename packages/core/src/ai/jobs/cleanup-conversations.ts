export type CleanupDeps = { deleteConversationsOlderThan: (cutoff: Date) => Promise<number> };

export type CleanupResult =
  | { deleted: number; skipped: false }
  | { deleted: 0; skipped: true; reason: 'retention_unlimited' };

/**
 * Retence konverzací. `0` znamená neomezeně, tedy že texty zůstanou v databázi
 * i v každé záloze navždy. Je to legitimní volba, ale je to rozhodnutí
 * o uchovávání osobních údajů, a proto se tady netiskne jako "mazání vypnuto",
 * ale vrací se důvod, který UI umí podat.
 */
export async function cleanupConversations(
  params: { retentionDays: number; now: Date },
  deps: CleanupDeps,
): Promise<CleanupResult> {
  if (!Number.isInteger(params.retentionDays) || params.retentionDays < 0) {
    throw new Error(`Neplatná retence konverzací: ${params.retentionDays}`);
  }
  if (params.retentionDays === 0) {
    return { deleted: 0, skipped: true, reason: 'retention_unlimited' };
  }
  const cutoff = new Date(params.now.getTime() - params.retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await deps.deleteConversationsOlderThan(cutoff);
  return { deleted, skipped: false };
}

/** Tenký obal pro frontu `ai.cleanup_conversations`. Fronta je v registru P01. */
export const handler = async (job: {
  data: { retentionDays: number };
  deps: CleanupDeps;
}): Promise<CleanupResult> =>
  cleanupConversations({ retentionDays: job.data.retentionDays, now: new Date() }, job.deps);
