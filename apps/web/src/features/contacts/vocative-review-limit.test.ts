import { describe, expect, it } from 'vitest';
// ODCHYLKA OD PLÁNU: plán importuje konstanty z `@mlain/core/contacts`, kde je barrel
// nereexportuje. Zrcadlí je `./limits`, viz komentář v tom souboru.
import { VOCATIVE_REVIEW_GROUP_SOFT_LIMIT, VOCATIVE_REVIEW_RATIO_SOFT_LIMIT } from './limits';
import { exceedsManualReviewLimit } from './vocative-review-limit';

describe('exceedsManualReviewLimit', () => {
  it('u malé fronty ruční práci nezpochybňuje', () => {
    expect(
      exceedsManualReviewLimit({ groups: 12, uncertainContacts: 143, totalContacts: 3214 }),
    ).toEqual({
      exceeded: false,
      reason: null,
      ratio: 143 / 3214,
    });
  });

  it('nad stropem skupin doporučí neutrální oslovení', () => {
    const result = exceedsManualReviewLimit({
      groups: 101,
      uncertainContacts: 200,
      totalContacts: 100000,
    });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toBe('groups');
  });

  it('přesně na stropu skupin ještě nedoporučuje', () => {
    expect(
      exceedsManualReviewLimit({ groups: 100, uncertainContacts: 200, totalContacts: 100000 })
        .exceeded,
    ).toBe(false);
  });

  it('nad desetinou kontaktů doporučí neutrální oslovení i při málo skupinách', () => {
    const result = exceedsManualReviewLimit({
      groups: 5,
      uncertainContacts: 400,
      totalContacts: 3000,
    });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toBe('ratio');
  });

  it('bez kontaktů nedělí nulou', () => {
    expect(exceedsManualReviewLimit({ groups: 0, uncertainContacts: 0, totalContacts: 0 })).toEqual(
      {
        exceeded: false,
        reason: null,
        ratio: 0,
      },
    );
  });

  it('čte hodnoty z konstant domény, nemá vlastní čísla', () => {
    expect(VOCATIVE_REVIEW_GROUP_SOFT_LIMIT).toBe(100);
    expect(VOCATIVE_REVIEW_RATIO_SOFT_LIMIT).toBe(0.1);
  });
});
