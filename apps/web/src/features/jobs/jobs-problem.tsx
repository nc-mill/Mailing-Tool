'use client';

import { useTranslations } from 'next-intl';
import type { Problem } from '@/lib/api-client/problem';
import { ProblemBlock } from '@/lib/errors/problem-block';

/**
 * Jediné místo, kde Centrum úloh vykresluje chybu. Neznámý kód spadne na
 * `detail` ze serveru, nikdy na prázdno (kritérium 76 části 6).
 *
 * Vlastní mapa kódů tady schválně NENÍ. Centrum úloh jen čte, takže jediné
 * kódy, které od API dostane, jsou `forbidden` a selhání spojení; obojí
 * pokrývají obecné texty z `common.errors`. Mapa se dvěma položkami by se
 * stejně dřív nebo později rozešla se skutečnými kódy.
 */
export function JobsProblem({ problem, onRetry }: { problem: Problem; onRetry?: () => void }) {
  const t = useTranslations('common');

  return (
    <ProblemBlock
      problem={problem}
      title={t('errors.loadFailedTitle', { entity: t('jobs.title') })}
      body={problem.detail || t('errors.genericBody')}
      occurredAt={new Date().toISOString()}
      {...(onRetry ? { onRetry } : {})}
      labels={{
        technicalDetails: t('errors.technicalDetails'),
        code: t('errors.code'),
        requestId: t('errors.requestId'),
        time: t('errors.time'),
        copyBlock: t('errors.copyBlock'),
        copied: t('actions.copied'),
        tryAgain: t('actions.tryAgain'),
      }}
    />
  );
}
