'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { archiveListAction, setConfirmationModeAction } from './actions';

export type ListDetailData = {
  id: string;
  name: string;
  confirmed_count: number;
  pending_count: number;
  double_opt_in: boolean;
  confirmation_mode: 'one_step' | 'two_step';
  archived: boolean;
};

export function ListDetail({
  basePath,
  workspaceId,
  list,
}: {
  basePath: string;
  /** Projekt pro změnu režimu potvrzení a archivaci. Bez něj API vrátí 404. */
  workspaceId: string;
  list: ListDetailData;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [mode, setMode] = useState(list.confirmation_mode);
  const [saved, setSaved] = useState(false);

  async function changeMode(next: 'one_step' | 'two_step') {
    setMode(next);
    const result = await setConfirmationModeAction({ workspaceId, id: list.id, mode: next });
    if (result.status === 'success') {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{list.name}</h1>

      <p data-testid="list-counts">
        {t('lists.members', { count: list.confirmed_count })}
        {', '}
        {t('lists.pending', { count: list.pending_count })}
      </p>

      <h2 className="font-semibold text-text">{t('lists.confirmationMode')}</h2>
      {/* Rozdíl mezi režimy se vysvětluje doslova. „Jednokrokové" versus „dvoukrokové"
          nikomu neřekne, co se stane, a hlavně zamlčí to podstatné: ani jeden režim
          nepotvrzuje na GET, protože firemní skenery odkazy v e-mailech proklikávají. */}
      <RadioGroup
        name="confirmation-mode"
        value={mode}
        onValueChange={(next: string) => void changeMode(next as 'one_step' | 'two_step')}
      >
        {(
          [
            {
              value: 'one_step',
              label: 'confirmationModeOneStep',
              hint: 'confirmationModeOneStepHint',
            },
            {
              value: 'two_step',
              label: 'confirmationModeTwoStep',
              hint: 'confirmationModeTwoStepHint',
            },
          ] as const
        ).map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={option.value}
              id={`confirmation-mode-${option.value}`}
              aria-labelledby={`confirmation-mode-label-${option.value}`}
            />
            <div className="flex flex-col gap-1">
              <span
                id={`confirmation-mode-label-${option.value}`}
                className="text-sm font-medium text-text"
              >
                {t(`lists.${option.label}`)}
              </span>
              <span className="text-sm text-text-muted">{t(`lists.${option.hint}`)}</span>
            </div>
          </div>
        ))}
      </RadioGroup>
      {saved ? <p role="status">{t('lists.confirmationModeChanged')}</p> : null}

      <h2 className="font-semibold text-text">{t('lists.doubleOptIn')}</h2>
      <p>{list.double_opt_in ? t('lists.doubleOptInOn') : t('lists.doubleOptInOff')}</p>

      {list.archived ? null : (
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              await archiveListAction({ workspaceId, id: list.id });
              router.push(basePath);
            }}
          >
            {t('lists.archive')}
          </Button>
        </div>
      )}
    </section>
  );
}
