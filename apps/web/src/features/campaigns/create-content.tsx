'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Alert } from '@mlain/ui/patterns/states';
import { createCampaignContentAction } from './actions';
import { CampaignBreadcrumbs } from './campaign-breadcrumbs';
import { CampaignStepNav } from './campaign-steps';
import { CAMPAIGN_STEPS, campaignStepHref, type CampaignStep } from './steps';

/**
 * Krok 1 u kampaně, která ještě nemá svou pracovní kopii obsahu.
 *
 * Potřebují to kampaně z doby před tímhle uspořádáním (`template_id` je NULL
 * a obsah nemá kde vzniknout) a kampaně, u kterých založení obsahu poprvé
 * selhalo. Bez téhle obrazovky by krok 1 skončil u prázdného editoru nebo
 * u věty „kampaň nemá obsah" bez jediné cesty ven.
 *
 * OBSAH KAMPANĚ NENÍ ŠABLONA. Zakládá se pracovní kopie, tedy řádek `templates`
 * s `kind = 'system'`, který se v knihovně nevypisuje. Kampaň ho vlastní sama,
 * takže psaní newsletteru nikdy nesahá na nic, co má uživatel uložené pro příště.
 */
export function CreateCampaignContent({
  workspaceId,
  campaignId,
  campaignName,
  basePath,
  canEdit,
}: {
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  basePath: string;
  /** Rozjetá kampaň se needituje, obsah jí už nikdo nezaloží. */
  canEdit: boolean;
}) {
  const t = useTranslations('campaigns.settings');
  const tContent = useTranslations('campaigns.settings.content');
  const tNew = useTranslations('campaigns.new');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function goToStep(step: CampaignStep) {
    router.push(campaignStepHref(basePath, campaignId, step));
  }

  return (
    <section className="flex flex-col">
      <PageHeader
        title={campaignName}
        eyebrow={
          <span role="status" aria-live="polite">
            {tNew('stepOf', { current: 1, total: CAMPAIGN_STEPS.length })}
          </span>
        }
        breadcrumbs={<CampaignBreadcrumbs basePath={basePath} campaignName={campaignName} />}
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        <CampaignStepNav current="content" onSelect={goToStep} />

        {failed && (
          <Alert tone="error" data-testid="content-outcome">
            {tContent('createFailed')}
          </Alert>
        )}

        <p className="max-w-[90ch] text-meta text-text-muted">{t('steps.contentIntro')}</p>

        <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
          <p className="text-ui text-text-muted">{tContent('noContent')}</p>
          {canEdit ? (
            <Button
              variant="primary"
              data-testid="create-content"
              pending={pending}
              pendingLabel={tContent('creating')}
              onClick={() =>
                startTransition(async () => {
                  const result = await createCampaignContentAction({
                    workspaceId,
                    campaignId,
                    campaignName,
                    locale,
                  });
                  if (result.status === 'error') {
                    setFailed(true);
                    return;
                  }
                  // Táž adresa, jen s obsahem: stránka se překreslí a otevře editor.
                  setFailed(false);
                  router.refresh();
                })
              }
            >
              {tContent('createContent')}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
