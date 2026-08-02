import type { ReactNode } from 'react';

export type DashboardPeriod = 7 | 30 | 90;

export function parsePeriod(value: string | null): DashboardPeriod {
  const parsed = Number(value);
  return parsed === 7 || parsed === 90 ? parsed : 30;
}

/** Proklik je hlavní číslo, otevření stojí vedle něj a menší. */
export function tileOrder(): string[] {
  return ['click_rate', 'sent', 'open_rate', 'problems', 'web_active', 'recent_campaigns'];
}

export function isStale(computedAt: string, ttlMs: number, now: Date): boolean {
  return now.getTime() - new Date(computedAt).getTime() > ttlMs * 2;
}

/**
 * Zdroje 3 až 5 z 8.11.1 (kvóta provideru, stav doručitelnosti, rozdělaná práce)
 * vlastní jiné plány. Přehled je bere jako sloty, takže jejich selhání
 * nezhroutí stránku a jejich doplnění nevyžaduje zásah do téhle obrazovky.
 */
export type DashboardSlots = {
  providerQuota?: ReactNode;
  deliverabilityWarning?: ReactNode;
  onboardingSteps?: ReactNode;
};
