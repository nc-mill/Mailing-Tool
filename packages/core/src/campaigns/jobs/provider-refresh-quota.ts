import { deriveProviderStatus } from '../../providers/state-machine';
import { quotaRemaining, shouldPauseForQuota } from '../../providers/ses/account';
import { buildPauseReason } from '../pause-reason';

export const REFRESH_QUOTA_JOB = {
  queue: 'provider.refresh_quota' as const,
  cron: '*/15 * * * *',
  singletonKey: (providerId: string) => `provider.quota:${providerId}`,
  retryLimit: 3,
  expireInSeconds: 120,
};

export type RefreshQuotaDeps = {
  loadProvider(
    workspaceId: string,
    providerId: string,
  ): Promise<{
    type: string;
    signals: Parameters<typeof deriveProviderStatus>[0];
    previousStatus: string;
  }>;
  fetchAccount(
    workspaceId: string,
    providerId: string,
  ): Promise<
    {
      quota_max_24h: number | null;
      quota_sent_24h: number | null;
      enforcement_status: string | null;
      sending_enabled: boolean | null;
    } & Record<string, unknown>
  >;
  saveSnapshot(workspaceId: string, providerId: string, snapshot: unknown): Promise<void>;
  setStatus(workspaceId: string, providerId: string, status: string): Promise<void>;
  pauseAll(
    workspaceId: string,
    providerId: string,
    reason: ReturnType<typeof buildPauseReason>,
  ): Promise<{ paused: number }>;
  emit(input: {
    workspaceId: string;
    type: string;
    providerId: string;
    data?: unknown;
  }): Promise<void>;
  quotaPauseBelow: number;
};

/**
 * `workspaceId` je tady OBSAH nakladu, ne autorizace: pg-boss doruci holy JSON.
 * Naklad je proto pojmenovany typ, ne anonymni objekt v seznamu parametru; `scope.test.ts`
 * zakazuje `workspaceId: string` primo v seznamu parametru exportovane funkce a vzor
 * vyjimky je `IssueUnsubscribeTokenInput`.
 */
export type RefreshQuotaPayload = { workspaceId: string; providerId: string };

export async function refreshQuotaHandler(
  deps: RefreshQuotaDeps,
  payload: RefreshQuotaPayload,
): Promise<void> {
  const { workspaceId, providerId } = payload;
  const before = await deps.loadProvider(workspaceId, providerId);

  // Selhani volani NEBLOKUJE bezici kampan: pouzije se posledni znama hodnota.
  let account: Awaited<ReturnType<RefreshQuotaDeps['fetchAccount']>>;
  try {
    account = await deps.fetchAccount(workspaceId, providerId);
  } catch {
    return;
  }
  await deps.saveSnapshot(workspaceId, providerId, account);

  const status = deriveProviderStatus({
    ...before.signals,
    enforcementStatus: (account.enforcement_status ?? 'HEALTHY') as never,
    sendingEnabled: account.sending_enabled ?? true,
  });

  if (status !== before.previousStatus) {
    await deps.setStatus(workspaceId, providerId, status);
    await deps.emit({
      workspaceId,
      type: 'provider.status_changed',
      providerId,
      data: { from: before.previousStatus, to: status },
    });
  }

  // Prechod do blocked pozastavi vsechny bezici kampane toho provideru.
  if (status === 'blocked') {
    await deps.pauseAll(
      workspaceId,
      providerId,
      buildPauseReason('provider_blocked', 'app', {
        detail: `enforcement_status=${account.enforcement_status}, sending_enabled=${account.sending_enabled}`,
      }),
    );
    return;
  }

  const remaining = quotaRemaining(account);
  if (shouldPauseForQuota(remaining, { pauseBelow: deps.quotaPauseBelow })) {
    await deps.pauseAll(
      workspaceId,
      providerId,
      buildPauseReason('provider_quota_exhausted', 'app', {
        detail: `zbývá ${remaining} zpráv z denního limitu`,
      }),
    );
  }
}
