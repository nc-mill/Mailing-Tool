'use client';

import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { loadUsage, type UsageReport } from './delete-assets';
import type { AssetRow, AssetUsageRef } from './types';

/**
 * Potvrzení hromadného smazání.
 *
 * ROZDĚLUJE VÝBĚR NA TŘI HROMÁDKY, protože každá znamená pro uživatele něco
 * jiného a jedna společná věta by lhala aspoň jedné z nich:
 *
 *  1. Nepoužité. Smazání je bezpečné, stačí obyčejné potvrzení.
 *  2. Použité v šabloně nebo v rozepsané kampani. Smazat je JDE, ale odkaz se
 *     rozpadne, takže uživatel musí vidět KDE, ne jen kolikrát. Proto zvláštní
 *     zaškrtnutí „rozumím, že se odkazy rozpadnou": zadání žádá výslovné
 *     potvrzení s uvedením místa použití.
 *  3. Použité odeslanou kampaní. Ty se NENABÍZEJÍ ke smazání vůbec, jen se
 *     vypíšou s důvodem. Server je stejně odmítne (409), a nabídnout akci,
 *     která skončí chybou, je horší než ji nenabídnout.
 *
 * Místa použití se dotahují AŽ PO OTEVŘENÍ dialogu, ne při každém zaškrtnutí
 * v mřížce. Uživatel při vybírání kliká rychle a každé kliknutí by znamenalo
 * dotaz na server.
 */
export function DeleteAssetsDialog({
  open,
  assets,
  workspaceId,
  pending,
  onCancel,
  onConfirm,
  fetchImpl,
}: {
  open: boolean;
  assets: readonly AssetRow[];
  workspaceId: string;
  pending: boolean;
  onCancel: () => void;
  /** Dostane jen ty obrázky, které se skutečně smí smazat. */
  onConfirm: (deletable: AssetRow[]) => void;
  fetchImpl?: typeof globalThis.fetch;
}) {
  const t = useTranslations('assets');
  const acknowledgeId = useId();
  const [reports, setReports] = useState<UsageReport[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) {
      setReports(null);
      setAcknowledged(false);
      return;
    }
    let active = true;
    void loadUsage({
      assets,
      workspaceId,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    }).then((loaded) => {
      if (active) setReports(loaded);
    });
    return () => {
      active = false;
    };
  }, [open, assets, workspaceId, fetchImpl]);

  const known = reports ?? assets.map((asset) => ({ asset, usedBy: [] as AssetUsageRef[] }));

  /**
   * Zablokované pozná se podle odkazu z KAMPANĚ, ne podle nenulového počtu.
   * Šablona mazání nebrání (specifikace 3.14.5), kdežto kampaň, která odešla,
   * ano. Server rozlišuje týmž způsobem, takže se tu jen předchází chybě 409,
   * ne nahrazuje jeho rozhodnutí: co projde tady, může server pořád odmítnout,
   * a výsledek se pak ukáže v hlášce.
   */
  const blocked = known.filter((report) => report.usedBy.some((use) => use.type === 'campaign'));
  const blockedIds = new Set(blocked.map((report) => report.asset.id));
  const deletable = known.filter((report) => !blockedIds.has(report.asset.id));
  const used = deletable.filter(
    (report) => report.usedBy.length > 0 || report.asset.referenceCount > 0,
  );

  const needsAcknowledgement = used.length > 0;
  const canConfirm = deletable.length > 0 && (!needsAcknowledgement || acknowledged);

  function describe(use: AssetUsageRef): string {
    const name = use.name === '' ? t('usage.unnamed') : use.name;
    return use.type === 'campaign'
      ? t('usage.inCampaign', { name })
      : t('usage.inTemplate', { name });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())} destructive>
      <DialogTitle>{t('delete.title', { count: assets.length })}</DialogTitle>
      <DialogBody>
        {reports === null ? <p className="text-ui text-text-muted">{t('usage.loading')}</p> : null}

        <p className="text-ui text-text">
          {needsAcknowledgement ? t('delete.usedLead') : t('delete.safeLead')}
        </p>

        {used.length > 0 ? (
          <section
            data-testid="delete-used"
            className="flex flex-col gap-[var(--spacing-hairline)]"
          >
            <h3 className="text-ui font-semibold text-text">{t('delete.usedHeading')}</h3>
            <ul className="flex flex-col gap-[var(--spacing-hairline)] text-sm text-text-muted">
              {used.map((report) => (
                <li key={report.asset.id}>
                  <span className="font-semibold text-text">{report.asset.originalFilename}</span>
                  {report.usedBy.length > 0 ? (
                    <span> · {report.usedBy.map(describe).join(', ')}</span>
                  ) : (
                    <span> · {t('usage.used', { count: report.asset.referenceCount })}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Zablokované se od zbytku odlišují plochou, ne jen nadpisem: je to jediná
            hromádka, se kterou uživatel nic neudělá, a musí to poznat dřív, než
            bude hledat, proč se počet smazaných nesešel. */}
        {blocked.length > 0 ? (
          <Card
            as="section"
            tone="muted"
            padding="sm"
            gap="none"
            data-testid="delete-blocked"
            className="gap-[var(--spacing-hairline)]"
          >
            <h3 className="text-ui font-semibold text-text">{t('delete.blockedHeading')}</h3>
            <p className="text-sm text-text-muted">{t('delete.blockedLead')}</p>
            <ul className="flex flex-col gap-[var(--spacing-hairline)] font-mono text-meta text-text-muted">
              {blocked.map((report) => (
                <li key={report.asset.id}>{report.asset.originalFilename}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        {needsAcknowledgement ? (
          <label
            className="flex items-center gap-[var(--spacing-inline)] text-ui text-text"
            htmlFor={acknowledgeId}
          >
            <Checkbox
              id={acknowledgeId}
              checked={acknowledged}
              onCheckedChange={(next) => setAcknowledged(next === true)}
            />
            {t('delete.confirmUnderstood')}
          </label>
        ) : null}
      </DialogBody>
      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={onCancel}>
            {t('delete.cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="destructive"
            pending={pending}
            pendingLabel={t('delete.pending')}
            // Destruktivní tlačítko `disabled` nepřijímá (pravidlo skořápky):
            // zašedlé tlačítko bez vysvětlení je slepá ulička. Místo toho nese
            // důvod, proč zatím nejde použít.
            {...(canConfirm
              ? {}
              : {
                  unavailableReason: t('delete.confirmUnderstood'),
                  onUnavailable: () => undefined,
                })}
            onClick={() => {
              if (canConfirm) onConfirm(deletable.map((report) => report.asset));
            }}
          >
            {t('delete.confirm')}
          </Button>
        }
      />
    </Dialog>
  );
}
