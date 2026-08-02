'use client';

import { useTranslations } from 'next-intl';
import type { OnboardingState } from '@mlain/core/onboarding';
import { Button } from '@mlain/ui/components/button';
import { cn } from '@mlain/ui/lib/cn';
import { OnboardingStepRow } from './onboarding-step-row';

/**
 * `Panel` v design systému neexistuje a P05 ho zakládat nebude, takže se
 * skládá tady z primitiv. Je to obyčejný rám se třemi tóny, žádné chování,
 * takže vlastní komponenta v `packages/ui` by byla dalším prvkem katalogu
 * kvůli jednomu použití.
 */
function Panel({
  tone = 'default',
  label,
  children,
}: {
  tone?: 'default' | 'success' | 'muted';
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      // `aria-label` NENÍ ozdoba a nesmí se odsud smazat.
      //
      // Holý `<section>` NEMÁ roli `region`. Dostane ji teprve tehdy, když má
      // přístupné jméno. Bez něj panel v přístupnostním stromu vůbec není,
      // takže ho neuvidí ani odečítač obrazovky, ani navigace po orientačních
      // bodech. Naměřeno v běžící instalaci: `getByRole('region')` vracelo
      // šest dlaždic Přehledu a panel onboardingu mezi nimi nebyl.
      aria-label={label}
      className={cn(
        'rounded-[var(--radius-surface)] border p-4',
        tone === 'success' && 'border-success bg-success-surface',
        tone === 'muted' && 'border-border bg-surface-muted',
        tone === 'default' && 'border-border bg-surface',
      )}
    >
      {children}
    </section>
  );
}

export type OnboardingPanelProps = {
  state: OnboardingState;
  slug: string;
  onHide?: (hidden: boolean) => void;
  onDismiss?: () => void;
};

async function postHidden(hidden: boolean): Promise<void> {
  await fetch('/api/v1/onboarding/hide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hidden }),
  });
}

/**
 * Trvalý panel místo prohlídky s bublinami. Prohlídku uživatel zavře a už ji
 * nikdy neuvidí; seznam zůstane, dá se k němu vrátit a je vidět, co zbývá.
 * Panel proto jde jen skrýt, ne zavřít. Nadobro se zavírá až jednorázová
 * gratulace po odeslání první kampaně.
 */
export function OnboardingPanel({ state, slug, onHide, onDismiss }: OnboardingPanelProps) {
  const t = useTranslations('onboarding.panel');

  if (state.finished && state.finishedDismissed) return null;

  if (state.finished) {
    return (
      <Panel tone="success" label={t('title')}>
        <p>{t('finished')}</p>
        <Button
          variant="ghost"
          onClick={() => {
            onDismiss?.();
            void fetch('/api/v1/onboarding/hide', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dismissFinished: true }),
            });
          }}
        >
          {t('finishedDismiss')}
        </Button>
      </Panel>
    );
  }

  if (state.hidden) {
    return (
      <Panel tone="muted" label={t('title')}>
        <p>{t('collapsed', { done: state.doneCount, total: state.total })}</p>
        <Button
          variant="ghost"
          onClick={() => {
            onHide?.(false);
            void postHidden(false);
          }}
        >
          {t('show')}
        </Button>
      </Panel>
    );
  }

  return (
    <Panel label={t('title')}>
      <div className="flex items-center justify-between">
        <h2>{t('title')}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            onHide?.(true);
            void postHidden(true);
          }}
        >
          {t('hide')}
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        {t('remaining', { count: state.total - state.doneCount })}
      </p>
      <ol>
        {state.steps.map((step) => (
          <OnboardingStepRow key={step.id} step={step} slug={slug} />
        ))}
      </ol>
    </Panel>
  );
}
