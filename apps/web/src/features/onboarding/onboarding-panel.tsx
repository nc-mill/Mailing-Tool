'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { OnboardingState } from '@mlain/core/onboarding';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';
import { cn } from '@mlain/ui/lib/cn';
import { dismissOnboardingFinishedAction, setOnboardingHiddenAction } from './actions';
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

/**
 * Trvalý panel místo prohlídky s bublinami. Prohlídku uživatel zavře a už ji
 * nikdy neuvidí; seznam zůstane, dá se k němu vrátit a je vidět, co zbývá.
 * Panel proto jde jen skrýt, ne zavřít. Nadobro se zavírá až jednorázová
 * gratulace po odeslání první kampaně.
 *
 * OBĚ TLAČÍTKA PŘEKRESLUJÍ PANEL SAMA, NEČEKAJÍ NA SERVER. Přehled je serverová
 * stránka, takže odpověď akce sama o sobě na obrazovce nic nezmění; bez místního
 * stavu by panel po kliknutí zůstal viset až do ručního obnovení. Uložený stav
 * pak dorazí přes `router.refresh()` a místní hodnota s ním souhlasí.
 *
 * KDYŽ ZÁPIS SELŽE, PANEL SE VRÁTÍ A ŘEKNE SE TO. Dřív se odpověď zahazovala
 * přes `void`, takže „Zavřít" na trvale selhávajícím požadavku vypadalo jako
 * mrtvé tlačítko. Přesně kvůli tomu tenhle soubor vznikl znovu.
 */
export function OnboardingPanel({ state, slug, onHide, onDismiss }: OnboardingPanelProps) {
  const t = useTranslations('onboarding.panel');
  const router = useRouter();
  const toast = useToast();
  // `null` znamená „uživatel zatím nic nepřepnul", takže platí hodnota ze serveru.
  const [hiddenOverride, setHiddenOverride] = useState<boolean | null>(null);
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const [pending, setPending] = useState(false);

  const hidden = hiddenOverride ?? state.hidden;

  async function toggleHidden(next: boolean): Promise<void> {
    const previous = hidden;
    onHide?.(next);
    setHiddenOverride(next);
    setPending(true);
    const result = await setOnboardingHiddenAction({ workspaceRef: slug, hidden: next });
    setPending(false);
    if (result.status === 'error') {
      setHiddenOverride(previous);
      toast.error(t('saveFailed', { code: result.code }));
      return;
    }
    router.refresh();
  }

  async function dismissFinished(): Promise<void> {
    onDismiss?.();
    setDismissedLocally(true);
    setPending(true);
    const result = await dismissOnboardingFinishedAction({ workspaceRef: slug });
    setPending(false);
    if (result.status === 'error') {
      setDismissedLocally(false);
      toast.error(t('dismissFailed', { code: result.code }));
      return;
    }
    router.refresh();
  }

  if (state.finished && (state.finishedDismissed || dismissedLocally)) return null;

  if (state.finished) {
    return (
      <Panel tone="success" label={t('title')}>
        <p>{t('finished')}</p>
        <Button variant="ghost" pending={pending} onClick={() => void dismissFinished()}>
          {t('finishedDismiss')}
        </Button>
      </Panel>
    );
  }

  if (hidden) {
    return (
      <Panel tone="muted" label={t('title')}>
        <p>{t('collapsed', { done: state.doneCount, total: state.total })}</p>
        <Button variant="ghost" pending={pending} onClick={() => void toggleHidden(false)}>
          {t('show')}
        </Button>
      </Panel>
    );
  }

  return (
    <Panel label={t('title')}>
      <div className="flex items-center justify-between">
        <h2>{t('title')}</h2>
        <Button variant="ghost" pending={pending} onClick={() => void toggleHidden(true)}>
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
