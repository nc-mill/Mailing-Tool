'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { IconButton } from '@mlain/ui/components/icon-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus, SlidersHorizontal } from '@mlain/ui/icons';
import { CampaignList, type CampaignListState, type CampaignRow } from './campaign-list';
import { deleteCampaignAction } from './actions';
import { DeleteCampaignDialog } from './delete-campaign-dialog';

/** Stavy, ve kterých je kampaň rozepsaná, tedy se do meta řádku počítá. */
const DRAFT_STATUSES = new Set(['draft', 'scheduled', 'schedule_missed']);

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
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);
  /*
   * Nastavení sloupců patří podle návrhu do HLAVIČKY obrazovky, vedle hlavní
   * akce, ne nad tabulku. Stav proto drží obrazovka a tabulka ho jen dostane;
   * bez toho by si tabulka nakreslila vlastní tlačítko o řádek níž.
   */
  const [columnsOpen, setColumnsOpen] = useState(false);

  /*
   * Meta řádek pod nadpisem. Skládá se ze tří údajů oddělených tečkou:
   * kolik kampaní je vidět, kolik z nich je rozepsaných a kdy naposledy něco
   * odešlo. Poslední odeslání se bere z `finished_at`, ne z `updated_at`:
   * změna nastavení rozepsané kampaně není odeslání.
   */
  const drafts = rows.filter((row) => DRAFT_STATUSES.has(row.status)).length;
  const lastFinished = rows
    .map((row) => row.finished_at)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1);
  const meta = [
    t('list.metaCount', { count: rows.length }),
    t('list.metaDrafts', { count: drafts }),
    lastFinished === undefined
      ? t('list.metaNeverSent')
      : t('list.metaLastSent', { date: format.dateTime(new Date(lastFinished), 'short') }),
  ].join(' · ');

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
    <>
      {/*
        Nadpis stránky je jen u dat: prázdný stav i chybový blok si nesou vlastní.

        Tlačítko „Vytvořit kampaň" patří VEDLE nadpisu, ne jen do prázdného stavu.
        Dřív bylo pouze tam, takže po založení první kampaně zmizelo a druhou už
        nešlo z rozhraní založit vůbec; jediná cesta dál byla přímo přes API.
      */}
      {state === 'data' && (
        <PageHeader
          title={t('list.title')}
          meta={meta}
          actions={
            <>
              <IconButton
                label={tc('table.columns')}
                icon={<SlidersHorizontal aria-hidden className="icon-md" />}
                aria-expanded={columnsOpen}
                onClick={() => setColumnsOpen((open) => !open)}
              />
              <Button variant="primary" data-testid="create-campaign" onClick={create}>
                <Plus aria-hidden className="icon-md" />
                {t('list.emptyAction')}
              </Button>
            </>
          }
        />
      )}
      <CampaignList
        rows={rows}
        state={state}
        basePath={`${basePath}/campaigns`}
        onCreate={create}
        onRetry={() => router.refresh()}
        onDelete={(row) => setDeleting(row)}
        columnSettings={{ open: columnsOpen, onOpenChange: setColumnsOpen }}
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
    </>
  );
}
