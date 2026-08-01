export const RECONCILE_JOB = {
  queue: 'outbox.reconcile' as const,
  cron: '*/1 * * * *',
  retryLimit: 3,
  expireInSeconds: 55,
};

export type ReconcileDeps = {
  listWorkspaces(): Promise<string[]>;
  reconcile(workspaceId: string): Promise<{ revoked: number }>;
  log(level: 'info' | 'warn', msg: string, meta?: unknown): void;
};

/** Bezi kazdych 60 sekund a je idempotentni: druhy beh nad tymz stavem zrusi nula radku. */
export async function reconcileHandler(deps: ReconcileDeps): Promise<{ revoked: number }> {
  let revoked = 0;
  for (const workspaceId of await deps.listWorkspaces()) {
    const r = await deps.reconcile(workspaceId);
    revoked += r.revoked;
    if (r.revoked > 0) {
      deps.log('warn', 'zachytna cesta zrusila zpravy, okamzita cesta nezabrala', {
        workspaceId,
        revoked: r.revoked,
      });
    }
  }
  return { revoked };
}
