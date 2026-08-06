'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import type { Problem } from '@/lib/api-client/problem';
import { ProblemBlock } from '@/lib/errors/problem-block';

export type CampaignLoadProblemProps = {
  problem: Problem;
  /** ISO čas ze serveru. Dopočet na klientovi by rozbil hydrataci. */
  occurredAt: string;
};

/**
 * Kampaň se nepodařilo NAČÍST. Není to totéž co „kampaň neexistuje".
 *
 * Obrazovka nastavení kampaně dřív na každé selhání čtení volala `notFound()`,
 * takže se uživateli nad živou kampaní objevila věta „stránka nenalezena".
 * Ta věta je nepravdivá a hlavně nepoužitelná: uživatel z ní usoudí, že mu
 * kampaň někdo smazal, přestože se jen nedočetla.
 *
 * Selhat se přitom dá i bez smazané kampaně. `apiFetch` má desetisekundový
 * časový limit a vypršení převádí na `dependency_timeout`; totéž potká
 * nedostupné API (`service_unavailable`) i vnitřní chybu (`internal_error`).
 * Žádný z těch tří případů nic neříká o existenci kampaně, a přesně z nich
 * vznikaly hlášky o 404 na kampani, kterou pak nikdo nedokázal zopakovat.
 *
 * SKUTEČNOU 404 z API řeší volající: ta jediná zůstává `notFound()`.
 *
 * Je to táž oprava, jakou už jednou dostala obrazovka odeslání, viz
 * `PreflightProblem`. Tam se to napravilo, tady zůstala stará podoba.
 */
export function CampaignLoadProblem({ problem, occurredAt }: CampaignLoadProblemProps) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const router = useRouter();

  return (
    <ProblemBlock
      problem={problem}
      title={tc('errors.loadFailedTitle', { entity: t('loadError.entity') })}
      /*
       * Vypršení má vlastní větu: „zkuste to znovu" je u něj pravdivá rada,
       * kdežto u ostatních kódů je to jen zdvořilost. Rozdíl je pro uživatele
       * podstatný, protože po vypršení druhý pokus opravdu obvykle projde.
       */
      body={
        problem.code === 'dependency_timeout' ? tc('errors.timeoutBody') : tc('errors.genericBody')
      }
      occurredAt={occurredAt}
      onRetry={() => router.refresh()}
      labels={{
        technicalDetails: tc('errors.technicalDetails'),
        code: tc('errors.code'),
        requestId: tc('errors.requestId'),
        time: tc('errors.time'),
        copyBlock: tc('actions.copy'),
        copied: tc('actions.copied'),
        tryAgain: t('preflightError.retry'),
      }}
    />
  );
}
