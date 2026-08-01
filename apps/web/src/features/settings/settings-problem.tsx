'use client';

import { useTranslations } from 'next-intl';
import type { Problem } from '@/lib/api-client/problem';
import { SETTINGS_ERROR_KEYS, errorTextKeys } from '@/lib/errors/error-keys';
import { ProblemBlock } from '@/lib/errors/problem-block';

export type SettingsProblemProps = {
  problem: Problem;
  onRetry?: (() => void) | undefined;
  values?: Record<string, string | number> | undefined;
};

/**
 * Jediné místo, kde se v nastavení vykresluje chyba. Neznámý kód spadne na
 * `detail` ze serveru (kritérium 76 části 6), nikdy na prázdno.
 *
 * ODCHYLKA OD PLÁNU, jen úklid: plán tu volal `useFormatter()` a výsledek
 * nikde nepoužil.
 */
export function SettingsProblem({ problem, onRetry, values }: SettingsProblemProps) {
  const t = useTranslations('settings');
  const keys = errorTextKeys(SETTINGS_ERROR_KEYS, problem.code);
  const occurredAt = new Date().toISOString();

  return (
    <ProblemBlock
      problem={problem}
      title={keys ? t(keys.title) : t('errors.fallback.title')}
      body={keys ? t(keys.body, values ?? {}) : problem.detail || t('errors.fallback.body')}
      occurredAt={occurredAt}
      {...(onRetry ? { onRetry } : {})}
      labels={{
        technicalDetails: t('errorBlock.detailsSummary'),
        code: t('errorBlock.code'),
        requestId: t('errorBlock.requestId'),
        time: t('errorBlock.time'),
        copyBlock: t('errorBlock.copyAll'),
        copied: t('errorBlock.copied'),
        tryAgain: t('errorBlock.retry'),
      }}
    />
  );
}
