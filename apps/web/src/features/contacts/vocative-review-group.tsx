'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Select, SelectItem } from '@mlain/ui/components/select';
import type { VocativeReviewCommand, VocativeReviewGroupView } from './vocative-review-types';

export type { VocativeReviewCommand, VocativeReviewGroupView };

const REASON_KEY: Record<string, string> = {
  gender_unknown: 'vocative.reason.genderUnknown',
  gender_conflict: 'vocative.reason.genderConflict',
  LIBRARY_HEURISTIC: 'vocative.reason.libraryHeuristic',
  AMBIGUOUS_GIVEN_NAME: 'vocative.reason.ambiguousGivenName',
  non_latin_script: 'vocative.reason.nonLatinScript',
};

export function VocativeReviewGroup({
  group,
  deferred,
  onApply,
  onDefer,
  onUndefer,
}: {
  group: VocativeReviewGroupView;
  /** Odložení je klientská volba (rozhodnutí R15), server o něm neví. */
  deferred: boolean;
  onApply: (command: VocativeReviewCommand) => void;
  onDefer: () => void;
  onUndefer: () => void;
}) {
  const t = useTranslations('contacts');
  // Zaškrtnuto ve výchozím stavu. Bez toho by fronta konvergovala k nule jen náhodou:
  // stejné jméno by se vrátilo s každým dalším importem (4.5.3 části 2).
  const [saveOverride, setSaveOverride] = useState(true);
  const [vocative, setVocative] = useState(group.suggested_vocative ?? '');
  const [gender, setGender] = useState(group.gender);

  function apply(
    action: VocativeReviewCommand['action'],
    overrides: Partial<VocativeReviewCommand> = {},
  ) {
    onApply({
      name_key: group.name_key,
      kind: group.kind,
      action,
      gender,
      vocative: group.suggested_vocative,
      save_override: saveOverride,
      ...overrides,
    });
  }

  return (
    <li
      data-testid="vocative-group"
      className="flex flex-col gap-3 rounded-[var(--radius-surface)] border border-border bg-surface p-4"
    >
      <h3 className="text-base font-semibold text-text">{group.display_name}</h3>
      <p className="text-sm text-text-muted">
        {t('vocative.groupCount', { count: group.contact_count })}
      </p>
      {group.sample_surnames.length > 0 ? (
        <p className="text-sm text-text-muted">
          {t('vocative.groupSample', { surnames: group.sample_surnames.join(', ') })}
        </p>
      ) : null}

      <p>{t('vocative.groupHint', { name: group.display_name })}</p>
      <ul className="list-disc pl-5 text-sm text-text-muted">
        {group.reasons.map((reason) => (
          <li key={reason}>{REASON_KEY[reason] ? t(REASON_KEY[reason]) : reason}</li>
        ))}
      </ul>

      {group.suggested_vocative === null ? (
        <p>{t('vocative.suggestedNone')}</p>
      ) : (
        <p>{t('vocative.suggested', { vocative: group.suggested_vocative })}</p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`vocative-${group.kind}-${group.name_key}`}>
            {t('vocative.vocativeLabel')}
          </Label>
          <Input
            id={`vocative-${group.kind}-${group.name_key}`}
            value={vocative}
            onChange={(event) => setVocative(event.target.value)}
          />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`gender-${group.kind}-${group.name_key}`}>
            {t('vocative.genderLabel')}
          </Label>
          <Select
            aria-label={t('vocative.genderLabel')}
            placeholder={t('detail.genderUnknown')}
            value={gender}
            onValueChange={(next: string) => setGender(next as VocativeReviewGroupView['gender'])}
          >
            <SelectItem value="female">{t('detail.genderFemale')}</SelectItem>
            <SelectItem value="male">{t('detail.genderMale')}</SelectItem>
            <SelectItem value="unknown">{t('detail.genderUnknown')}</SelectItem>
          </Select>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-text">
        <Checkbox
          id={`override-${group.kind}-${group.name_key}`}
          checked={saveOverride}
          onCheckedChange={(next) => setSaveOverride(next === true)}
        />
        <span>{t('vocative.saveOverride', { name: group.display_name })}</span>
      </label>
      <p className="text-sm text-text-muted">{t('vocative.saveOverrideHint')}</p>

      <div className="flex flex-wrap gap-2">
        {group.suggested_vocative === null ? null : (
          <Button variant="primary" onClick={() => apply('confirm')}>
            {t('vocative.actionConfirm')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => apply('set_vocative', { vocative })}>
          {t('vocative.actionSetVocative')}
        </Button>
        <Button variant="secondary" onClick={() => apply('set_gender')}>
          {t('vocative.actionSetGender')}
        </Button>
        <Button variant="secondary" onClick={() => apply('no_name', { vocative: null })}>
          {t('vocative.actionNoName')}
        </Button>
        <Button variant="secondary" onClick={deferred ? onUndefer : onDefer}>
          {deferred ? t('vocative.actionUndefer') : t('vocative.actionDefer')}
        </Button>
      </div>
      <p className="text-sm text-text-muted">{t('vocative.noNameHint')}</p>
      <p className="text-sm text-text-muted">{t('vocative.deferHint')}</p>
    </li>
  );
}
