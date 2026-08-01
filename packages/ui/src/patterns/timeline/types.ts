export type TimelineEvent = {
  id: string;
  /** Typ události, například `page_view`, `email_open`, `consent_given`. */
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type TimelineItem =
  | { kind: 'single'; id: string; type: string; occurredAt: Date; event: TimelineEvent }
  | { kind: 'cluster'; id: string; type: string; occurredAt: Date; events: TimelineEvent[] };

export type DayGroup = {
  /** Klíč dne v zóně uživatele, tvar YYYY-MM-DD. */
  key: string;
  /** `today`, `yesterday` nebo `date`. Text dodává katalog. */
  label: 'today' | 'yesterday' | 'date';
  date: Date;
  items: TimelineItem[];
};
