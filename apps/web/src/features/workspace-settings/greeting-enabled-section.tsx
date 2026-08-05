'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Switch } from '@mlain/ui/components/switch';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Workspace } from '@/lib/identity/workspace-access';
import { updateGreetingEnabledAction } from './actions';

export type GreetingEnabledSectionViewProps = {
  workspace: Workspace;
  canWrite: boolean;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
};

/**
 * VYPÍNAČ OSLOVENÍ A 5. PÁDU.
 *
 * Rozhodnutí zadavatele z 5. 8. 2026: „V angličtině se vůbec neřeší 5. pád
 * a oslovení. Mělo by to být možné v nastavení celé vypnout a pak by se to
 * nezobrazovalo nikde."
 *
 * Sekce stojí NAD volbou vykání a tykání schválně: řídí i ji. `address_form`
 * nemá v celém repozitáři jiného konzumenta než `buildGreeting`, takže
 * s vypnutým oslovením by ta volba nedělala vůbec nic.
 *
 * BEZ POTVRZOVACÍHO DIALOGU, na rozdíl od sousední `AddressFormSection`. Ta se
 * ptá proto, že spouští přepočet oslovení u všech kontaktů projektu. Tenhle
 * přepínač nespouští nic a nic nemaže, takže dialog by jen tvrdil, že se něco
 * děje. Co se stane, říká věta pod přepínačem.
 *
 * Akce se volá PŘÍMO v `useTransition`, ne přes `<form action={…}>`. Důvod je
 * popsaný v `address-form-section.tsx`: React 19 po doběhnutí akce formulář
 * vynuluje a řízený přepínač skočí zpátky na původní hodnotu.
 */
export function GreetingEnabledSectionView({
  workspace,
  canWrite,
  action,
  initialState,
}: GreetingEnabledSectionViewProps) {
  const t = useTranslations('settings');
  const [state, setState] = useState<ActionState>(initialState ?? IDLE);
  /** Zvolená hodnota, dokud se nevrátí ze serveru. Bez ní by přepínač poskočil zpět. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [, startTransition] = useTransition();

  const enabled = chosen ?? workspace.greeting_enabled;

  function submit(next: boolean) {
    setChosen(next);
    setState(IDLE);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('workspace_id', workspace.id);
      formData.set('greeting_enabled', String(next));
      const result = await action(IDLE, formData);
      setState(result);
      // Odmítnutou hodnotu přepínač dál ukazovat nesmí, byla by to tichá lež.
      if (result.status === 'error') setChosen(null);
    });
  }

  return (
    <section aria-labelledby="general-greeting-enabled">
      <h2 id="general-greeting-enabled" className="text-xl font-semibold">
        {t('general.greetingEnabled.label')}
      </h2>
      <p className="mt-2 text-text-muted">{t('general.greetingEnabled.hint')}</p>

      {state.status === 'success' ? (
        <p role="status" className="mt-4 text-text-muted">
          {t(state.messageKey)}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <div className="mt-4 flex items-start gap-3">
        <Switch
          id="greeting-enabled"
          checked={enabled}
          disabled={!canWrite}
          data-testid="greeting-enabled-switch"
          onCheckedChange={(next: boolean) => submit(next)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="greeting-enabled" className="text-sm font-medium text-text">
            {enabled ? t('general.greetingEnabled.on') : t('general.greetingEnabled.off')}
          </label>
          <span className="text-sm text-text-muted">
            {enabled ? t('general.greetingEnabled.onHint') : t('general.greetingEnabled.offHint')}
          </span>
        </div>
      </div>
    </section>
  );
}

/** Obálka, která sekci dodá serverovou akci, aby ji stránka nemusela znát. */
export function GreetingEnabledSection(props: Omit<GreetingEnabledSectionViewProps, 'action'>) {
  return <GreetingEnabledSectionView {...props} action={updateGreetingEnabledAction} />;
}
