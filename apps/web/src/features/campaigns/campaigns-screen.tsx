'use client';

import { useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { IconButton } from '@mlain/ui/components/icon-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Plus, SlidersHorizontal } from '@mlain/ui/icons';
import { useToast } from '@mlain/ui/patterns/toast';
import { CampaignList, type CampaignListState, type CampaignRow } from './campaign-list';
import {
  cancelCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  pauseCampaignAction,
  renameCampaignAction,
  resumeCampaignAction,
  unscheduleCampaignAction,
} from './actions';
import type { CampaignPermissions, CampaignRowAction } from './campaign-state';
import { CancelCampaignDialog } from './cancel-campaign-dialog';
import { DeleteCampaignDialog } from './delete-campaign-dialog';
import { RenameCampaignDialog } from './rename-campaign-dialog';

/** Stavy, ve kterých je kampaň rozepsaná, tedy se do meta řádku počítá. */
const DRAFT_STATUSES = new Set(['draft', 'scheduled', 'schedule_missed']);

/**
 * Klientský obal seznamu kampaní. Existuje kvůli hranici serverových komponent:
 * funkce `onCreate` ani obsluha řádkové nabídky se přes ni předat nedají, takže
 * se akce volají až tady.
 *
 * OKNA DRŽÍ OBRAZOVKA, NE ŘÁDEK. Obsah rozbalené nabídky se při volbě položky
 * odpojí z DOM, takže okno vykreslené uvnitř ní by zmizelo dřív, než by se
 * stačilo ukázat. Je to týž důvod, jaký má u sebe napsaný seznam kontaktů.
 */
export function CampaignsScreen({
  rows,
  state,
  basePath,
  workspaceId,
  permissions,
}: {
  rows: CampaignRow[];
  state: CampaignListState;
  basePath: string;
  workspaceId: string;
  /**
   * Práva přihlášeného člověka. Počítá je stránka přes `hasPermission`; klientská
   * komponenta se na role ptát nemá a ani nemá kde.
   */
  permissions: CampaignPermissions;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);
  const [renaming, setRenaming] = useState<CampaignRow | null>(null);
  const [cancelling, setCancelling] = useState<CampaignRow | null>(null);
  const [, startTransition] = useTransition();
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

  /**
   * Vratné akce z nabídky: proběhnou rovnou, bez potvrzení.
   *
   * Pozastavení, pokračování i zrušení plánu se dají vzít zpět jedním kliknutím
   * v téže nabídce, takže potvrzovací okno by bylo klikání navíc, na které si
   * uživatel zvykne odpovídat bez čtení. Nevratné akce (zrušení rozesílky,
   * smazání) mají okno vlastní a tudy nechodí.
   *
   * VÝSLEDEK MUSÍ BÝT VIDĚT. Řádek se po obnovení liší jen odznakem stavu, což
   * je změna, které si na obrazovce s deseti řádky nikdo nevšimne; oznámení říká,
   * co se stalo, a selhání vysvětlí kódem ze serveru místo mlčení.
   */
  function runReversible(
    action: 'unschedule' | 'pause' | 'resume',
    row: CampaignRow,
    run: (input: {
      workspaceId: string;
      campaignId: string;
    }) => Promise<{ status: 'success' } | { status: 'error'; code: string }>,
  ) {
    startTransition(async () => {
      const result = await run({ workspaceId, campaignId: row.id });
      if (result.status !== 'success') {
        toast.error(t(`rowActions.${action}Failed`, { detail: result.code }));
        return;
      }
      toast.success(t(`rowActions.${action}Done`, { name: row.name }));
      router.refresh();
    });
  }

  /**
   * Duplikace. Odchází se ROVNOU DO KOPIE, ne zpátky do seznamu.
   *
   * Kopie je `draft` se jménem „… (kopie)" a v seznamu by se objevila mezi
   * ostatními bez čehokoli, co by ji označovalo; kdo duplikoval odeslanou
   * kampaň, ji navíc chce hned upravit. Přechod je tedy zpětná vazba i další
   * krok naráz.
   */
  function duplicate(row: CampaignRow) {
    startTransition(async () => {
      const result = await duplicateCampaignAction({ workspaceId, campaignId: row.id });
      if (result.status !== 'success') {
        toast.error(t('rowActions.duplicateFailed', { detail: result.code }));
        return;
      }
      toast.success(t('rowActions.duplicateDone', { name: row.name }));
      router.push(`${basePath}/campaigns/${result.campaignId}`);
    });
  }

  function onRowAction(action: Exclude<CampaignRowAction, 'editContent'>, row: CampaignRow) {
    switch (action) {
      case 'rename':
        setRenaming(row);
        return;
      case 'duplicate':
        duplicate(row);
        return;
      case 'unschedule':
        runReversible('unschedule', row, unscheduleCampaignAction);
        return;
      case 'pause':
        runReversible('pause', row, pauseCampaignAction);
        return;
      case 'resume':
        runReversible('resume', row, resumeCampaignAction);
        return;
      case 'cancel':
        setCancelling(row);
        return;
      case 'delete':
        setDeleting(row);
        return;
    }
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
        rowActions={{ permissions, onAction: onRowAction }}
        columnSettings={{ open: columnsOpen, onOpenChange: setColumnsOpen }}
      />

      {renaming !== null && (
        <RenameCampaignDialog
          // `key` zařídí, že okno otevřené nad jinou kampaní začíná s jejím
          // jménem, ne s rozepsaným jménem té předchozí.
          key={renaming.id}
          campaign={renaming}
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          onRename={async (name) => {
            const result = await renameCampaignAction({
              workspaceId,
              campaignId: renaming.id,
              name,
            });
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}

      {cancelling !== null && (
        <CancelCampaignDialog
          key={cancelling.id}
          campaign={{
            name: cancelling.name,
            sent: cancelling.counters.sent,
            /*
             * `counters.total` je počet zpráv, které z publika doopravdy vznikly,
             * `audience_size` jeho odhadovaná velikost před materializací.
             * U kampaně, která už běží, je pravdivější to první; dokud se publikum
             * nezmrazí, je `total` nula a bere se druhé. Když není ani jedno, věta
             * o zbytku se vynechá celá, místo aby se dopočítala z nuly.
             */
            total:
              cancelling.counters.total > 0 ? cancelling.counters.total : cancelling.audience_size,
          }}
          open
          onOpenChange={(open) => {
            if (!open) setCancelling(null);
          }}
          onConfirm={async () => {
            const result = await cancelCampaignAction({
              workspaceId,
              campaignId: cancelling.id,
            });
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}

      {deleting !== null && (
        <DeleteCampaignDialog
          key={deleting.id}
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
