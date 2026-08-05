'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { CampaignList, type CampaignListState, type CampaignRow } from './campaign-list';
import { deleteCampaignAction } from './actions';
import { DeleteCampaignDialog } from './delete-campaign-dialog';

/**
 * Klientský obal seznamu kampaní. Existuje kvůli hranici serverových komponent:
 * funkce `onCreate` ani `onDelete` se přes ni předat nedají, takže se akce
 * volají až tady.
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
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);

  /*
   * Zakládání kampaně je vícekrokové a začíná OBSAHEM, ne prázdným řádkem
   * v databázi. Tlačítko proto vede na první krok průvodce a kampaň vzniká
   * až tam, jakmile si uživatel vybere prázdný e-mail nebo šablonu.
   *
   * Dřív se kampaň zakládala přímo odsud a jmenovala se „Vytvořit kampaň",
   * protože se jí za jméno dosadil popisek tlačítka.
   */
  function create() {
    router.push(`${basePath}/campaigns/new`);
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Nadpis stránky je jen u dat: prázdný stav i chybový blok si nesou vlastní.

        Tlačítko „Vytvořit kampaň" patří VEDLE nadpisu, ne jen do prázdného stavu.
        Dřív bylo pouze tam, takže po založení první kampaně zmizelo a druhou už
        nešlo z rozhraní založit vůbec; jediná cesta dál byla přímo přes API.
      */}
      {state === 'data' && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <Button variant="primary" data-testid="create-campaign" onClick={create}>
            {t('list.emptyAction')}
          </Button>
        </div>
      )}
      <CampaignList
        rows={rows}
        state={state}
        basePath={`${basePath}/campaigns`}
        onCreate={create}
        onRetry={() => router.refresh()}
        onDelete={(row) => setDeleting(row)}
      />
      {deleting !== null && (
        <DeleteCampaignDialog
          campaign={deleting}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const result = await deleteCampaignAction({
              workspaceId,
              campaignId: deleting.id,
            });
            // Obnova až po úspěchu. Kdyby běžela vždycky, přebila by chybovou
            // hlášku v dialogu novým vykreslením a uživatel by ji nepřečetl.
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}
    </div>
  );
}
