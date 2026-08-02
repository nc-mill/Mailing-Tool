'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Alert } from '@mlain/ui/patterns/states';
import { CampaignList, type CampaignListState, type CampaignRow } from './campaign-list';
import { createCampaignAction } from './actions';

/**
 * Klientský obal seznamu kampaní. Existuje kvůli hranici serverových komponent:
 * funkci `onCreate` přes ni předat nejde, takže se akce volá až tady.
 */
export function CampaignsScreen({
  rows,
  state,
  basePath,
  workspaceId,
}: {
  rows: CampaignRow[];
  state: CampaignListState;
  basePath: string;
  workspaceId: string;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Neúspěch akce se NIKDY nespolkne: dřív tlačítko po chybě jen nic neudělalo
  // a uživatel neměl jak poznat, že se kampaň nezaložila. Ověřeno v prohlížeči.
  const [failure, setFailure] = useState<string | null>(null);

  function create() {
    startTransition(async () => {
      const result = await createCampaignAction({ workspaceId, name: t('list.emptyAction') });
      if (result.status === 'success') router.push(`${basePath}/campaigns/${result.id}/send`);
      else setFailure(result.code);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Nadpis stránky je jen u dat: prázdný stav i chybový blok si nesou vlastní. */}
      {state === 'data' && <h1 className="text-xl font-semibold">{t('list.title')}</h1>}
      {failure !== null && (
        <Alert tone="error" data-testid="create-failed">
          {t('list.loadError')}
        </Alert>
      )}
      <CampaignList
        rows={rows}
        state={state}
        basePath={`${basePath}/campaigns`}
        onCreate={create}
        onRetry={() => router.refresh()}
      />
    </div>
  );
}
