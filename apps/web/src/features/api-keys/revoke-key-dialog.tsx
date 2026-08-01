'use client';

import { useActionState, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { ApiKeyRow } from './api-keys-table';
import { revokeApiKeyAction } from './actions';

export type RevokeKeyDialogViewProps = {
  apiKey: ApiKeyRow;
  workspaceId: string;
  slug: string;
  onClose: () => void;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

export function RevokeKeyDialogView({
  apiKey,
  workspaceId,
  slug,
  onClose,
  action,
}: RevokeKeyDialogViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const format = useFormatter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, IDLE);

  const lastUsed =
    apiKey.last_used_at === null
      ? t('shared.never')
      : format.dateTime(new Date(apiKey.last_used_at), 'short');

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="key_id" value={apiKey.id} readOnly />
      <input type="hidden" name="name" value={apiKey.name} readOnly />

      {state.status === 'error' ? <SettingsProblem problem={state.problem} /> : null}

      <ConfirmDialog
        open
        onOpenChange={(open: boolean) => {
          if (!open) onClose();
        }}
        level="N3"
        title={t('apiKeys.revoke.dialogTitle', { name: apiKey.name })}
        consequences={[
          t('apiKeys.revoke.consequence1'),
          t('apiKeys.revoke.consequence2'),
          t('apiKeys.revoke.consequence3', { lastUsed }),
        ]}
        acknowledgement={t('apiKeys.revoke.acknowledge')}
        confirmLabel={t('apiKeys.revoke.confirm', { name: apiKey.name })}
        cancelLabel={t('apiKeys.revoke.cancel')}
        onConfirm={() => formRef.current?.requestSubmit()}
        labels={confirmLabels}
      />
    </form>
  );
}

/** Serverová obálka, aby tabulka nemusela znát akci. */
export function RevokeKeyDialog(props: Omit<RevokeKeyDialogViewProps, 'action'>) {
  return <RevokeKeyDialogView {...props} action={revokeApiKeyAction} />;
}
