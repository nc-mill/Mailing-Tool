import pLimit from 'p-limit';

export const DOMAIN_RECHECK_JOB = {
  queue: 'domain.recheck' as const,
  cron: '* * * * *',
  singletonKey: (domainId: string) => `domain.check:${domainId}`,
  retryLimit: 3,
  expireInSeconds: 120,
};

export type DomainRecheckDeps = {
  listDue(): Promise<Array<{ workspaceId: string; domainId: string; wasVerified: boolean }>>;
  check(
    workspaceId: string,
    domainId: string,
  ): Promise<{ dkimOk: boolean | null; spfOk: boolean | null }>;
  emit(input: {
    workspaceId: string;
    type: string;
    domainId: string;
    data: unknown;
  }): Promise<void>;
  setProviderDegraded(workspaceId: string, domainId: string): Promise<void>;
  concurrency: number;
};

/**
 * Job je serialni jen v poradi vyberu, samotne kontrolky bezi soubezne s p-limit.
 * Pri stovkach domen by serialni pruchod trval minuty a domena zalozena na konci
 * fronty by se overila az za pul hodiny.
 *
 * Kdyz u OVERENE domeny prestane platit DKIM, bezici kampan se NEPOZASTAVI: SES
 * podepisuje z klice, ktery ma, a preruseni by uskodilo vic. Nova kampan se ale
 * spustit neda (preflight kontrola 4).
 */
export async function domainRecheckHandler(deps: DomainRecheckDeps): Promise<void> {
  const limit = pLimit(deps.concurrency);
  const due = await deps.listDue();
  await Promise.all(
    due.map((d) =>
      limit(async () => {
        const r = await deps.check(d.workspaceId, d.domainId);
        const nowVerified = r.dkimOk === true && r.spfOk === true;
        if (d.wasVerified !== nowVerified) {
          await deps.emit({
            workspaceId: d.workspaceId,
            type: 'domain.verification_changed',
            domainId: d.domainId,
            data: { verified: nowVerified },
          });
          if (!nowVerified) await deps.setProviderDegraded(d.workspaceId, d.domainId);
        }
      }),
    ),
  );
}
