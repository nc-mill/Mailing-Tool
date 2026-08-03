'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import type { Problem } from '@/lib/api-client/problem';
import { ProblemBlock } from '@/lib/errors/problem-block';

export type PreflightProblemProps = {
  problem: Problem;
  /** ISO čas ze serveru. Dopočet na klientovi by rozbil hydrataci. */
  occurredAt: string;
  settingsHref: string;
};

/**
 * Selhání předodeslací kontroly nad kampaní, KTERÁ EXISTUJE.
 *
 * Dřív obrazovka odeslání v tomhle případě volala `notFound()`, takže uživateli
 * na existující kampani vyskočila „stránka nenalezena". Ta věta je nepravdivá
 * a hlavně nepoužitelná: kontrola mohla selhat vypršenou relací nebo nedostupným
 * odesílacím účtem a uživatel neměl jak zjistit, co se stalo ani co s tím.
 *
 * Blok proto nese kód, číslo požadavku i čas (stav S9) a dvě cesty ven: zkusit
 * znovu a přejít do nastavení kampaně.
 */
export function PreflightProblem({ problem, occurredAt, settingsHref }: PreflightProblemProps) {
  const t = useTranslations('campaigns.preflightError');
  const tc = useTranslations('common');
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <ProblemBlock
        problem={problem}
        title={t('title')}
        body={t('body')}
        occurredAt={occurredAt}
        onRetry={() => router.refresh()}
        labels={{
          technicalDetails: tc('errors.technicalDetails'),
          code: tc('errors.code'),
          requestId: tc('errors.requestId'),
          time: tc('errors.time'),
          copyBlock: tc('actions.copy'),
          copied: tc('actions.copied'),
          tryAgain: t('retry'),
        }}
      />
      <p>
        <Link href={settingsHref} className="underline" data-testid="to-settings">
          {t('toSettings')}
        </Link>
      </p>
    </div>
  );
}
