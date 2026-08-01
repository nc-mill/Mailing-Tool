/**
 * Položka časové osy. `source` i `type` jsou OTEVŘENÉ výčty a klient musí
 * neznámou hodnotu tolerovat (4.2 části 5). Proto je typ `string`, ne union:
 * union by v klientovi vyrobil exhaustivní switch, který se u nové hodnoty
 * chová nedefinovaně, a projevilo by se to až u zákazníka.
 */
export type TimelineRow = {
  id: string;
  occurredAt: Date;
  source: string;
  type: string;
  campaign?: { id: string; name: string };
  sessionId?: string;
  reliability?: 'confirmed' | 'machine';
  detail?: Record<string, unknown>;
  /** Sloty pro složení věty, viz timeline/titles.ts. */
  slots: Record<string, string | number>;
};

export type TimelineItem = {
  id: string;
  occurred_at: string;
  source: string;
  type: string;
  title: string;
  detail?: Record<string, unknown>;
  campaign?: { id: string; name: string };
  session_id?: string;
  reliability?: 'confirmed' | 'machine';
};

export type TimelineFilter = 'email' | 'web' | 'contact' | 'consent';

export const TIMELINE_ORDER = 'occurred_at.desc';
