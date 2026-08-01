import { AUDIENCE_PREVIEW_SAMPLE_SIZE } from '../constants';
import type { AudienceGateCounts } from '../ports';

export type AudienceSampleRow = { contact_id: string; email: string; first_name: string | null };

export type AudiencePreview = {
  total: number;
  breakdown: {
    from_lists: number;
    from_segments: number;
    excluded_by_lists: number;
    excluded_by_segments: number;
    excluded_unsubscribed: number;
    excluded_unconfirmed: number;
    excluded_snoozed: number;
    excluded_processing_restricted: number;
    excluded_suppressed: number;
    excluded_invalid_email: number;
    excluded_deleted: number;
    excluded_sample: number;
    duplicates_removed: number;
  };
  sample: AudienceSampleRow[];
  computed_at: string;
  /** false, kdyz dotaz spadl na 5s strop a cislo je odhad z EXPLAIN. */
  exact: boolean;
};

/**
 * Cislo v radku Publikum, cislo na tlacitku, cislo v potvrzovacim dialogu a cislo
 * v rozpadu segmentu pochazeji z JEDNOHO volani (cast 6, 8.6.2). Kontrolni seznam
 * nesmi spocitat publikum sam; drive se dve obrazovky nad tymz segmentem rozchazely
 * o 24 lidi a rozdil byl prave na tlacitku, ktere spousti nevratnou akci.
 */
export function buildPreview(input: {
  gates: AudienceGateCounts;
  sample: AudienceSampleRow[];
  exact: boolean;
  computedAt: Date;
  bySelection?: {
    from_lists: number;
    from_segments: number;
    excluded_by_lists: number;
    excluded_by_segments: number;
  };
}): AudiencePreview {
  const s = input.bySelection ?? {
    from_lists: 0,
    from_segments: 0,
    excluded_by_lists: 0,
    excluded_by_segments: 0,
  };
  return {
    total: input.gates.eligible,
    breakdown: {
      from_lists: s.from_lists,
      from_segments: s.from_segments,
      excluded_by_lists: s.excluded_by_lists,
      excluded_by_segments: s.excluded_by_segments,
      excluded_unsubscribed: input.gates.excluded_unsubscribed,
      excluded_unconfirmed: input.gates.excluded_unconfirmed,
      excluded_snoozed: input.gates.excluded_snoozed,
      excluded_processing_restricted: input.gates.excluded_processing_restricted,
      excluded_suppressed: input.gates.excluded_suppressed,
      excluded_invalid_email: input.gates.excluded_invalid_email,
      excluded_deleted: input.gates.excluded_deleted,
      excluded_sample: input.gates.excluded_sample,
      duplicates_removed: input.gates.duplicates_removed,
    },
    sample: input.sample.slice(0, AUDIENCE_PREVIEW_SAMPLE_SIZE),
    computed_at: input.computedAt.toISOString(),
    exact: input.exact,
  };
}
