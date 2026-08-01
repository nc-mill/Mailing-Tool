export type SesGetAccountResponse = {
  SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number };
  ProductionAccessEnabled?: boolean;
  EnforcementStatus?: string;
  SendingEnabled?: boolean;
  Details?: { ReviewDetails?: { Status?: string } };
};

export type AccountSnapshot = {
  quota_max_24h: number | null;
  quota_max_send_rate: number | null;
  quota_sent_24h: number | null;
  production_access: boolean | null;
  enforcement_status: string | null;
  sending_enabled: boolean | null;
  review_status: string | null;
};

/**
 * Sandboxove hodnoty jsou podle dokumentace Max24HourSend = 200 a MaxSendRate = 1,
 * ale NIKDY je nepredpokladame, vzdy cteme z API. Sandbox se pozna z
 * ProductionAccessEnabled, ne z hodnoty kvoty.
 */
export function mapAccount(r: SesGetAccountResponse): AccountSnapshot {
  return {
    quota_max_24h: r.SendQuota?.Max24HourSend ?? null,
    quota_max_send_rate: r.SendQuota?.MaxSendRate ?? null,
    quota_sent_24h: r.SendQuota?.SentLast24Hours ?? null,
    production_access: r.ProductionAccessEnabled ?? null,
    enforcement_status: r.EnforcementStatus ?? null,
    sending_enabled: r.SendingEnabled ?? null,
    review_status: r.Details?.ReviewDetails?.Status ?? null,
  };
}

export function quotaRemaining(a: {
  quota_max_24h: number | null;
  quota_sent_24h: number | null;
}): number {
  if (a.quota_max_24h == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, a.quota_max_24h - (a.quota_sent_24h ?? 0));
}

/**
 * Mezera mezi prahy je HYSTEREZE a musi zustat: kdyby se pauzovalo i obnovovalo
 * na stejnem cisle, kampan by u vycerpane kvoty cyklila mezi paused a sending
 * kazdych deset minut.
 */
export function shouldPauseForQuota(remaining: number, cfg: { pauseBelow: number }): boolean {
  return remaining < cfg.pauseBelow;
}

export function shouldResumeForQuota(remaining: number, cfg: { resumeAbove: number }): boolean {
  return remaining > cfg.resumeAbove;
}
