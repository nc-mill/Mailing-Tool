'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { deleteCampaignAction } from './actions';
import { DeleteCampaignDialog, statusExplanationKey } from './delete-campaign-dialog';

/**
 * Smazání kampaně na jejím detailu.
 *
 * Stavy, ze kterých API kampaň smaže. TÝŽ výčet jako `DELETABLE_STATUSES`
 * v jádru; kdyby se rozešly, obrazovka by nabízela tlačítko, které vždycky
 * skončí na 409.
 */
const DELETABLE_STATUSES = new Set(['draft', 'schedule_missed']);

export function DeleteCampaignSection({
  workspaceId,
  campaign,
  basePath,
}: {
  workspaceId: string;
  campaign: { id: string; name: string; status: string };
  basePath: string;
}) {
  const t = useTranslations('campaigns.delete');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /*
   * U kampaně, kterou smazat nejde, se místo tlačítka vypíše DŮVOD. Tlačítko,
   * které po kliknutí jen ohlásí, že to nejde, je horší než věta, která to
   * řekne rovnou; a mlčení je ze všeho nejhorší, protože uživatel pak hledá
   * mazání tam, kde není.
   */
  if (!DELETABLE_STATUSES.has(campaign.status)) {
    return (
      <section aria-labelledby="campaign-delete" className="flex flex-col gap-2">
        <h2 id="campaign-delete" className="text-lg font-semibold">
          {t('sectionTitle')}
        </h2>
        <p className="text-sm text-text-muted" data-testid="delete-campaign-blocked">
          {t(statusExplanationKey(campaign.status))}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="campaign-delete" className="flex flex-col gap-2">
      <h2 id="campaign-delete" className="text-lg font-semibold">
        {t('sectionTitle')}
      </h2>
      <p className="text-sm text-text-muted">{t('sectionHint')}</p>
      <div>
        <Button variant="destructive" data-testid="delete-campaign" onClick={() => setOpen(true)}>
          {t('open')}
        </Button>
      </div>

      {open && (
        <DeleteCampaignDialog
          campaign={campaign}
          open
          onOpenChange={setOpen}
          onConfirm={async () => {
            const result = await deleteCampaignAction({ workspaceId, campaignId: campaign.id });
            // Detail smazané kampaně vrací 404, takže se nezůstává na místě:
            // po úspěchu se odchází na seznam.
            if (result.status === 'success') router.push(`${basePath}/campaigns`);
            return result;
          }}
        />
      )}
    </section>
  );
}
