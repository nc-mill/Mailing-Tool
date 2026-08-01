'use client';

import { useTranslations } from 'next-intl';
import type { Problem } from '@/lib/api-client/problem';
import { errorTextKeys, type ErrorTextKeys } from '@/lib/errors/error-keys';
import { ProblemBlock } from '@/lib/errors/problem-block';

/**
 * Kód chyby na text z katalogu `contacts`. Klíč se nikdy neskládá za běhu
 * (kritérium 71 části 6), a co v mapě není, spadne na `detail` ze serveru
 * (kritérium 76), nikdy na prázdno.
 */
export const CONTACTS_ERROR_KEYS = {
  contact_suppressed: {
    title: 'errors.contactSuppressed.title',
    body: 'errors.contactSuppressed.body',
  },
  contact_limit_reached: {
    title: 'errors.contactLimitReached.title',
    body: 'errors.contactLimitReached.body',
  },
  subscribe_blocked_complaint: {
    title: 'errors.subscribeBlockedComplaint.title',
    body: 'errors.subscribeBlockedComplaint.body',
  },
  suppression_not_removable: {
    title: 'errors.suppressionNotRemovable.title',
    body: 'errors.suppressionNotRemovable.body',
  },
  suppression_too_recent: {
    title: 'errors.suppressionTooRecent.title',
    body: 'errors.suppressionTooRecent.body',
  },
  field_limit_reached: {
    title: 'errors.fieldLimitReached.title',
    body: 'errors.fieldLimitReached.body',
  },
  indexed_field_limit_reached: {
    title: 'errors.indexedFieldLimitReached.title',
    body: 'errors.indexedFieldLimitReached.body',
  },
  field_type_immutable: {
    title: 'errors.fieldTypeImmutable.title',
    body: 'errors.fieldTypeImmutable.body',
  },
  field_used_by_scheduled_campaign: {
    title: 'errors.fieldUsedByScheduledCampaign.title',
    body: 'errors.fieldUsedByScheduledCampaign.body',
  },
  gdpr_not_verified: {
    title: 'errors.gdprNotVerified.title',
    body: 'errors.gdprNotVerified.body',
  },
  retention_below_minimum: {
    title: 'errors.retentionBelowMinimum.title',
    body: 'errors.retentionBelowMinimum.body',
  },
  contact_in_running_campaign: {
    title: 'errors.contactInRunningCampaign.title',
    body: 'errors.contactInRunningCampaign.body',
  },
  validation_failed: {
    title: 'errors.validationFailed.title',
    body: 'errors.validationFailed.body',
  },
} as const satisfies Record<string, ErrorTextKeys>;

/**
 * Jediné místo, kde se v doméně kontaktů vykresluje chyba.
 *
 * Popisky samotného bloku (podrobnosti, číslo požadavku, kopírování) jsou obecné
 * pro celý produkt a bydlí v katalogu `settings`, kam je zavedl P06. Nezdvojují se.
 */
export function ContactsProblem({
  problem,
  onRetry,
  values,
}: {
  problem: Problem;
  onRetry?: (() => void) | undefined;
  values?: Record<string, string | number> | undefined;
}) {
  const t = useTranslations('contacts');
  const tSettings = useTranslations('settings');
  const keys = errorTextKeys(CONTACTS_ERROR_KEYS, problem.code);

  return (
    <ProblemBlock
      problem={problem}
      title={keys ? t(keys.title) : t('errors.fallback.title')}
      body={keys ? t(keys.body, values ?? {}) : problem.detail || t('errors.fallback.body')}
      occurredAt={new Date().toISOString()}
      {...(onRetry ? { onRetry } : {})}
      labels={{
        technicalDetails: tSettings('errorBlock.detailsSummary'),
        code: tSettings('errorBlock.code'),
        requestId: tSettings('errorBlock.requestId'),
        time: tSettings('errorBlock.time'),
        copyBlock: tSettings('errorBlock.copyAll'),
        copied: tSettings('errorBlock.copied'),
        tryAgain: tSettings('errorBlock.retry'),
      }}
    />
  );
}
