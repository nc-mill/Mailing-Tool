import type { ReactElement } from 'react';
import type { PublicTranslator } from '@/features/public/i18n';

/**
 * Výsledek potvrzení adresy ve zkušebním režimu.
 *
 * Stránka je pro cizího člověka, ne pro uživatele nástroje, takže neobsahuje
 * navigaci do aplikace ani nic o projektu. Neúspěch je JEDNA stránka pro poškozený,
 * prošlý i neznámý odkaz: z rozdílu by šlo zjišťovat, které adresy v projektu jsou.
 */
export function VerifySenderPage({
  t,
  email,
}: {
  t: PublicTranslator;
  email: string | null;
}): ReactElement {
  if (email === null) {
    return (
      <>
        <h1>{t('verifyFailed')}</h1>
        <p>{t('verifyFailedDetail')}</p>
      </>
    );
  }
  return (
    <>
      <h1>{t('verifyDone')}</h1>
      <p>{t('verifyDoneDetail', { email })}</p>
    </>
  );
}
