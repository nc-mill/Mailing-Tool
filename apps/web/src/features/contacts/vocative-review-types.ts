/** Odpovídá typu VocativeReviewGroup z 5.7 části 2, plus jméno v původním tvaru pro zobrazení. */
export type VocativeReviewGroupView = {
  name_key: string;
  kind: 'first' | 'last';
  display_name: string;
  gender: 'female' | 'male' | 'unknown';
  gender_source: string;
  suggested_vocative: string | null;
  contact_count: number;
  sample_surnames: string[];
  sample_contact_id: string;
  reasons: string[];
};

/**
 * Příkaz nad skupinou fronty. Hodnota `defer` v něm schválně **není**: odložení
 * je volba zobrazení jednoho člověka, ne fakt o datech, a server o něm neví
 * (rozhodnutí R15 hlavičky plánu).
 */
export type VocativeReviewCommand = {
  name_key: string;
  kind: 'first' | 'last';
  action: 'confirm' | 'set_vocative' | 'set_gender' | 'no_name';
  gender: 'female' | 'male' | 'unknown';
  vocative: string | null;
  save_override: boolean;
};
