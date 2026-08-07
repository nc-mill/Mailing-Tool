'use client';

import type { JobsLabels } from '@mlain/ui/patterns/jobs';
import { useTranslations } from 'next-intl';

/**
 * Popisky pro `JobsBadge` v hlavičce. Návrhový systém katalog nezná, takže mu
 * je dodává aplikace, a to na jednom místě.
 *
 * BYLO JICH DVANÁCT, ZBYLY DVA. Zbytek obsluhoval `JobsCenter`, tedy seznam
 * úloh kreslený jako karty; ten 7. 8. zanikl, protože se seznam kreslí
 * `DataTable` jako všechny ostatní seznamy v produktu. Věta o počtu
 * zobrazených úloh přešla do stránkovací patičky tabulky, postup a jméno
 * spouštěče do sloupců.
 */
export function useJobsLabels(): JobsLabels {
  const t = useTranslations('common');

  return {
    title: t('jobs.title'),
    // `counts.runningJobs` schválně, ne vlastní klíč: tentýž plurál v katalogu
    // už byl. Větev pro nulu se nepoužije, odznak v tom případě říká „Úlohy".
    runningCount: (count: number) => t('counts.runningJobs', { count }),
  };
}
