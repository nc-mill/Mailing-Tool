'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { SelectField } from '@/lib/forms/select-field';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { ApiKeyRow } from './api-keys-table';
import { SecretReveal } from './secret-reveal';
import { rotateApiKeyAction, type SecretResult } from './actions';

/** Tři nabízené hodnoty místo volného pole. Rozsah 0 až 86400 je z 3.5 části 1. */
const GRACE_OPTIONS = [
  { value: '0', labelKey: 'apiKeys.rotate.graceOptions.none' },
  { value: '3600', labelKey: 'apiKeys.rotate.graceOptions.hour' },
  { value: '86400', labelKey: 'apiKeys.rotate.graceOptions.day' },
] as const;

export type RotateKeyDialogViewProps = {
  apiKey: ApiKeyRow;
  workspaceId: string;
  slug: string;
  onClose: () => void;
  action: (
    previous: ActionState<SecretResult>,
    formData: FormData,
  ) => Promise<ActionState<SecretResult>>;
};

export function RotateKeyDialogView({
  apiKey,
  workspaceId,
  slug,
  onClose,
  action,
}: RotateKeyDialogViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, IDLE);
  const [grace, setGrace] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const graceOption = GRACE_OPTIONS.find((option) => option.value === grace) ?? GRACE_OPTIONS[0];

  const rotated = state.status === 'success' ? state.data : undefined;

  if (rotated) {
    return (
      <SecretReveal
        secret={rotated.secret}
        titleKey="apiKeys.secret.title"
        warningKey="apiKeys.secret.warning"
        onClose={onClose}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="key_id" value={apiKey.id} readOnly />
      {/* `grace_seconds` do FormData vkládá SelectField vlastním skrytým polem. */}

      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      {/*
        Výběr doby dožití dřív stál uvnitř `<ConfirmDialog>` jako `children`.
        Ten prop komponenta nemá a mít nemá: dialog má popsat následky, ne
        sbírat vstupy. Pořadí je teď takové, jaké ve skutečnosti je: nejdřív
        se vybere doba, pak se potvrzuje, a hodnota se do následků promítne,
        takže uživatel v dialogu vidí, co přesně potvrzuje.
      */}
      <div className="mt-4">
        <SelectField
          name="grace_seconds"
          label={t('apiKeys.rotate.graceLabel')}
          placeholder={t('shared.selectPlaceholder')}
          defaultValue={grace}
          options={GRACE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          hint={t('apiKeys.rotate.graceHint')}
          onSelected={setGrace}
        />
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="button" variant="primary" onClick={() => setConfirming(true)}>
          {t('apiKeys.rotate.button')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('apiKeys.rotate.panelCancel')}
        </Button>
      </div>

      <ConfirmDialog
        // Dialog se otevře až po volbě doby dožití. Kdyby byl otevřený hned,
        // uživatel by potvrzoval hodnotu, na kterou pod ním nedosáhne.
        open={confirming}
        onOpenChange={setConfirming}
        level="N3"
        // Starý klíč po rotaci přestane platit a rozbije integrace mimo nástroj.
        destructive
        title={t('apiKeys.rotate.dialogTitle', { name: apiKey.name })}
        consequences={[
          t('apiKeys.rotate.consequence1'),
          t('apiKeys.rotate.consequence2', { grace: t(graceOption.labelKey) }),
          t('apiKeys.rotate.consequence3'),
        ]}
        acknowledgement={t('apiKeys.rotate.acknowledge')}
        confirmLabel={t('apiKeys.rotate.confirm')}
        cancelLabel={t('apiKeys.rotate.cancel')}
        onConfirm={() => formRef.current?.requestSubmit()}
        labels={confirmLabels}
      />
    </form>
  );
}

/** Serverová obálka, aby tabulka nemusela znát akci. */
export function RotateKeyDialog(props: Omit<RotateKeyDialogViewProps, 'action'>) {
  return <RotateKeyDialogView {...props} action={rotateApiKeyAction} />;
}
