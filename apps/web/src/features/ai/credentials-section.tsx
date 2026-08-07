'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Problem } from '@/lib/api-client/problem';
import { CredentialList, type ProviderOption, type PublicCredential } from './credential-list';
import {
  deleteAiCredentialAction,
  makeDefaultAiCredentialAction,
  testAiCredentialAction,
} from './actions';

/**
 * `CredentialList` je záměrně hloupá komponenta (viz její test „akce se
 * nabízí jen tam, kde je obsluha"): tenhle obal jí dodává obsluhu tlačítek
 * Otestovat, Nastavit jako výchozí a Smazat klíč. Volá serverové akce přímo,
 * ne přes `<form>` a `useActionState`: řádků je proměnlivě mnoho a jeden
 * hook na řádek by znamenal samostatnou podkomponentu jen kvůli tomu.
 * `useTransition` zajišťuje, že `revalidatePath` v akci opravdu překreslí
 * serverovou stránku (nutné podmínka pro volání akce mimo formulář).
 */
export function CredentialsSection({
  credentials,
  providers,
  workspaceId,
  slug,
}: {
  credentials: readonly PublicCredential[];
  providers: readonly ProviderOption[];
  workspaceId: string;
  slug: string;
}) {
  const t = useTranslations('ai');
  const confirmLabels = useConfirmDialogLabels();
  const [, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<PublicCredential | null>(null);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  function identify(credentialId: string) {
    return { workspace_id: workspaceId, slug, credential_id: credentialId };
  }

  function handleTest(credentialId: string) {
    setProblem(null);
    setTestOk(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('workspace_id', workspaceId);
      formData.set('slug', slug);
      formData.set('credential_id', credentialId);
      const state = await testAiCredentialAction(IDLE, formData);
      if (state.status === 'error') setProblem(state.problem);
      else setTestOk(credentialId);
    });
  }

  function handleMakeDefault(credentialId: string) {
    setProblem(null);
    startTransition(async () => {
      const result = await makeDefaultAiCredentialAction(identify(credentialId));
      if (!result.ok) setProblem(result.problem);
    });
  }

  function handleDeleteConfirm() {
    const target = deleting;
    if (target === null) return;
    startTransition(async () => {
      const result = await deleteAiCredentialAction(identify(target.id));
      if (!result.ok) setProblem(result.problem);
      setDeleting(null);
    });
  }

  return (
    <>
      {problem !== null ? (
        <div className="mb-4">
          <SettingsProblem problem={problem} />
        </div>
      ) : null}
      {testOk !== null ? (
        <p className="mb-4 text-sm text-success-text">{t('credentials.testOk')}</p>
      ) : null}

      <CredentialList
        credentials={credentials}
        providers={providers}
        onTest={handleTest}
        onMakeDefault={handleMakeDefault}
        onDelete={(credentialId) => {
          const target = credentials.find((credential) => credential.id === credentialId) ?? null;
          setDeleting(target);
        }}
      />

      {deleting !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          level="N2"
          // Uložený klíč zmizí a znovu se dá jen vypsat od poskytovatele.
          destructive
          title={t('credentials.deleteConfirm', { label: deleting.label })}
          consequences={[]}
          confirmLabel={t('credentials.delete')}
          cancelLabel={t('credentials.cancel')}
          labels={confirmLabels}
          onConfirm={handleDeleteConfirm}
        />
      ) : null}
    </>
  );
}
