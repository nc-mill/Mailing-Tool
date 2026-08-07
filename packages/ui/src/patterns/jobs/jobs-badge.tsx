'use client';

import { Layers } from '../../icons';
import { type JobsLabels } from './types';

/**
 * Odznak počítá **běžící** úlohy. Dokončené odznak nedělají,
 * aby se nedalo dostat do stavu trvale svítící ikony.
 * Ikona zůstává i bez běžících úloh, aby šla najít historie.
 *
 * BERE ČÍSLO, NE SEZNAM ÚLOH. Dřív dostával `jobs: JobSummary[]` a běžící si
 * z něj počítal sám, jenže to nutilo hlavičku načíst celý seznam úloh kvůli
 * jednomu číslu na každé stránce aplikace. `/api/v1/jobs` vrací `running_count`
 * samostatně právě proto, aby to nebylo potřeba.
 *
 * IKONA JE `Layers`, tedy hromádka, a je to druhá volba.
 *
 * Ozubené kolo tu být nesmí: to je v aplikaci Nastavení a mít ho v hlavičce
 * podruhé, o dva prvky vedle uživatelské nabídky, znamená dvě různé věci pod
 * stejným tvarem.
 *
 * Nejdřív tu byl `LoaderCircle`. Zadavatel ho 7. 8. odmítl jako nepochopitelný
 * a měl pravdu: v šestnácti pixelech je to prostě NEDOKONČENÝ KROUŽEK, který
 * nic neznamená. Kroužek nahrávání navíc svou roli plní jen tehdy, když se
 * točí, a tenhle odznak stojí v hlavičce pořád, i když neběží nic.
 *
 * Hromádka drží význam i bez pohybu a bez popisku: je to práce srovnaná
 * za sebou, tedy fronta. Číslo v rohu se na ni váže přirozeně.
 */
export function JobsBadge({
  runningCount,
  labels,
  onOpen,
}: {
  runningCount: number;
  labels: JobsLabels;
  onOpen: () => void;
}) {
  const running = Math.max(0, runningCount);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={running > 0 ? labels.runningCount(running) : labels.title}
      className="relative flex size-11 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-muted"
    >
      <Layers aria-hidden className="icon-md" />
      {running > 0 ? (
        <span
          data-testid="jobs-badge-count"
          aria-hidden
          className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-center text-xs text-primary-foreground"
        >
          {running}
        </span>
      ) : null}
    </button>
  );
}
