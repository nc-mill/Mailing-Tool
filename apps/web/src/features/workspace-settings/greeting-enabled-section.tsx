'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Switch } from '@mlain/ui/components/switch';
import { Alert } from '@mlain/ui/patterns/states';
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
    <Card aria-labelledby="general-greeting-enabled">
      <CardTitle>
        <span id="general-greeting-enabled">{t('general.greetingEnabled.label')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('general.greetingEnabled.hint')}</p>

      {state.status === 'success' ? (
        <Alert tone="success" role="status">
          {t(state.messageKey)}
        </Alert>
      ) : null}
      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      {/* Řádek s přepínačem má rozvržení z návrhu (sekce „Nabízet příjemcům"
          na detailu seznamu): přepínač v prvním sloupci, nad ním stav slovem,
          pod ním vysvětlení, co ta poloha znamená. Šířka sloupce je `auto`,
          aby seděla na skutečnou šířku přepínače z `packages/ui`. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        <Switch
          id="greeting-enabled"
          checked={enabled}
          disabled={!canWrite}
          data-testid="greeting-enabled-switch"
          onCheckedChange={(next: boolean) => submit(next)}
        />
        <label htmlFor="greeting-enabled" className="text-ui font-semibold text-text">
          {enabled ? t('general.greetingEnabled.on') : t('general.greetingEnabled.off')}
        </label>
        <span />
        <span className="text-meta text-text-muted">
          {enabled ? t('general.greetingEnabled.onHint') : t('general.greetingEnabled.offHint')}
        </span>
      </div>
    </Card>
  );
}

/** Obálka, která sekci dodá serverovou akci, aby ji stránka nemusela znát. */
export function GreetingEnabledSection(props: Omit<GreetingEnabledSectionViewProps, 'action'>) {
  return <GreetingEnabledSectionView {...props} action={updateGreetingEnabledAction} />;
}
