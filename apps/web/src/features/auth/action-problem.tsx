'use client';

import { useTranslations } from 'next-intl';
import { AUTH_ERROR_KEYS, errorTextKeys } from '@/lib/errors/error-keys';
import { ProblemBlock } from '@/lib/errors/problem-block';
import type { Problem } from '@/lib/api-client/problem';

export type AuthProblemProps = {
  problem: Problem;
  onRetry?: (() => void) | undefined;
  /** Hodnoty do zprávy, například počet sekund u rate limitu. */
  values?: Record<string, string | number> | undefined;
};

/**
 * Jediné místo, kde se v obrazovkách přihlášení vykresluje chyba. Neznámý kód
 * spadne na `detail` ze serveru (kritérium 76 části 6), nikdy na prázdno.
 *
 * ODCHYLKA OD PLÁNU, jen úklid: plán tu volal `useFormatter()` a výsledek
 * nikde nepoužil. Nepoužitá proměnná by neprošla lintem a nic by nezměnila.
 */
export function AuthProblem({ problem, onRetry, values }: AuthProblemProps) {
  const t = useTranslations('auth');
  const keys = errorTextKeys(AUTH_ERROR_KEYS, problem.code);
  const occurredAt = new Date().toISOString();

  const title = keys ? t(keys.title) : t('errors.fallback.title');
  const body = keys ? t(keys.body, values ?? {}) : problem.detail || t('errors.fallback.body');

  return (
    <ProblemBlock
      problem={problem}
      title={title}
      body={body}
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
