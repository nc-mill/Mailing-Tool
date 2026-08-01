import { VOCATIVE_REVIEW_GROUP_SOFT_LIMIT, VOCATIVE_REVIEW_RATIO_SOFT_LIMIT } from './limits';

export type ManualReviewInput = {
  groups: number;
  uncertainContacts: number;
  totalContacts: number;
};

export type ManualReviewVerdict = {
  exceeded: boolean;
  reason: 'groups' | 'ratio' | null;
  ratio: number;
};

/**
 * Rozhodnutí zadavatele: „Když nejisté případy překročí 100 skupin nebo 10 % importu,"
 * nabídne se jako doporučená volba neutrální oslovení. Není to zákaz ruční práce,
 * je to přiznání, že nad tímhle množstvím ji nikdo neudělá a fronta zůstane viset.
 *
 * Strop je měkký: překročení mění jen výchozí doporučení, ne dostupnost akcí.
 */
export function exceedsManualReviewLimit(input: ManualReviewInput): ManualReviewVerdict {
  const ratio = input.totalContacts === 0 ? 0 : input.uncertainContacts / input.totalContacts;

  if (input.groups > VOCATIVE_REVIEW_GROUP_SOFT_LIMIT) {
    return { exceeded: true, reason: 'groups', ratio };
  }
  if (ratio > VOCATIVE_REVIEW_RATIO_SOFT_LIMIT) {
    return { exceeded: true, reason: 'ratio', ratio };
  }
  return { exceeded: false, reason: null, ratio };
}
