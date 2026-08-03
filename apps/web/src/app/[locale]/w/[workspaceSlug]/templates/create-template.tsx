'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { emptyDocument } from '@/features/editor/model/document-types';
import { createHttpPorts } from '@/features/editor/ports/http-ports';

/**
 * Vytvoření šablony je **klientská** akce, ne odkaz na `/templates/new`.
 *
 * Dřívější znění na takovou stránku odkazovalo, jenže ji nezakládá žádný plán,
 * takže by tlačítko v prázdném stavu vedlo na 404. Endpoint `POST /api/v1/templates`
 * existuje a přijímá hotový dokument, takže žádná mezistránka není potřeba:
 * pošle se nejmenší platný dokument a rovnou se otevře editor.
 *
 * `EmptyState` z P05 bere akce jako `{ label, onClick }`, což přes hranici
 * serverové komponenty poslat nejde. Proto je celý prázdný stav tady.
 */
function useCreateTemplate(workspaceSlug: string, workspaceId: string) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('editor');
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const create = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        // `workspaceId` je povinný: bez hlavičky `X-Workspace-Id` vrací
        // `POST /api/v1/templates` 404 a tlačítko je mrtvé.
        const ports = createHttpPorts({ workspaceId });
        const created = await ports.createTemplate({
          name: t('list.newName'),
          document: emptyDocument(locale),
        });
        router.push(`/w/${workspaceSlug}/templates/${created.id}`);
      } catch {
        setFailed(true);
      }
    });
  };

  return { create, pending, failed, t };
}

export function CreateTemplateButton({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { create, pending, failed, t } = useCreateTemplate(workspaceSlug, workspaceId);
  return (
    <div className="flex items-center gap-2">
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      {/* Primární akce nikdy nedostane `disabled` (kritérium 18). Během běhu se
          mění popisek, ne dostupnost. */}
      <Button
        variant="primary"
        pending={pending}
        pendingLabel={t('header.saving')}
        onClick={create}
      >
        {t('list.create')}
      </Button>
    </div>
  );
}

export function TemplatesEmpty({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { create, failed, t } = useCreateTemplate(workspaceSlug, workspaceId);
  return (
    <>
      {failed ? <Alert tone="error" title={t('list.createFailed')} /> : null}
      <EmptyState
        variant="first"
        title={t('list.empty')}
        explanation={t('list.emptyHint')}
        actions={[{ label: t('list.create'), onClick: create }]}
      />
    </>
  );
}
