'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Trash2 } from '@mlain/ui/icons';
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
  /*
   * Karta mazání má DANGER RÁMEČEK, ne danger plochu: je to nebezpečná akce,
   * ale ne chyba, takže má být poznat na první pohled a přesto nekřičet přes
   * celou stránku.
   */
  const dangerCard = 'border-danger';

  if (!DELETABLE_STATUSES.has(campaign.status)) {
    return (
      <Card aria-labelledby="campaign-delete" padding="md" className={dangerCard}>
        <CardTitle className="text-danger-text">
          <span id="campaign-delete">{t('sectionTitle')}</span>
        </CardTitle>
        <p className="text-meta text-text-muted" data-testid="delete-campaign-blocked">
          {t(statusExplanationKey(campaign.status))}
        </p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="campaign-delete" padding="md" className={dangerCard}>
      <CardTitle className="text-danger-text">
        <span id="campaign-delete">{t('sectionTitle')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('sectionHint')}</p>
      <div>
        {/* Obrysová destruktivní, ne plná červená plocha: návrh chce, aby byla
            akce vidět, ale aby na kartě nesvítila jako výstraha. */}
        <Button
          variant="destructiveOutline"
          data-testid="delete-campaign"
          onClick={() => setOpen(true)}
        >
          <Trash2 aria-hidden className="icon-sm" />
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
    </Card>
  );
}
