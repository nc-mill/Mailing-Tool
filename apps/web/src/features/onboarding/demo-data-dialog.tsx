'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';

export type DemoCounts = {
  contacts: number;
  lists: number;
  tags: number;
  segments: number;
  templates: number;
  campaigns: number;
};

/**
 * Co úklid udělá s věcmi MIMO ukázkovou sadu. Počítá to `readDemoImpact`
 * v jádře, tady se z toho jen skládá věta, a jen když je co říct.
 */
export type DemoImpact = {
  contacts: number;
  campaigns: number;
};

/**
 * Odstranění ukázkových dat je podle škály rizika 6.1 části 6 úroveň **N2**:
 * rozsah nad 100 položek by dával 2 body, ale obnovitelnost je 0 (sada se dá
 * nahrát znovu jedním kliknutím) a vnější dopad 0 (na adresy example.com se
 * nikdy nic neposlalo). Součet 2 znamená potvrzovací dialog se souhrnem
 * a počty, **bez zaškrtávacího políčka a bez opisování názvu**.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KOMPONENTOU: plán volal `ConfirmDialog`
 * s propy `body` a `initialFocus`. Komponenta v `packages/ui` bere `consequences`
 * (pole konkrétních vět), `labels` a `onOpenChange`, a fokus na ústupovém
 * tlačítku si nastavuje sama. Zaškrtávací pole se u N2 nevykreslí, protože
 * si ho komponenta váže na N3, opisování na N4.
 */
export function DemoDataDialog({
  open,
  counts,
  impact,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  counts: DemoCounts;
  /**
   * Chybí, dokud API dopad neposílá (starší odpověď). Věta se pak nevykreslí,
   * což je správně: tvrdit nulu, kterou nikdo nespočítal, by bylo horší než
   * mlčet.
   */
  impact?: DemoImpact | null | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('onboarding.demo');
  const labels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      level="N2"
      // POZOR, tohle okno se ptá na ODSTRANĚNÍ ukázkových dat, ne na jejich
      // založení (nadpis „Odstranit ukázková data?", potvrzení volá
      // `removeDemoDataAction`). Původní komentář tvrdil opak a příštího čtenáře
      // by poslal špatným směrem.
      //
      // `false` přesto zůstává, a ne z nedopatření: sada se dá jedním kliknutím
      // nahrát znovu, na adresy example.com nikdy nic neodešlo a odstranění je
      // akce, ke které produkt sám vybízí pruhem na Přehledu. Červená patří
      // ztrátě, kterou nejde vzít zpátky; kdyby svítila i na úklidu ukázkové
      // sady, přestala by rozlišovat mazání skutečných kontaktů.
      destructive={false}
      title={t('dialogTitle')}
      consequences={[
        t('dialogContacts', {
          contacts: counts.contacts,
          lists: counts.lists,
          tags: counts.tags,
        }),
        t('dialogContent', {
          segments: counts.segments,
          templates: counts.templates,
          campaigns: counts.campaigns,
        }),
        t('dialogSafety'),
        // Úpravy ukázkových položek mizí VŽDY, i když v projektu nic dalšího
        // není: řádek z manifestu se maže i tehdy, když ho uživatel mezitím
        // přepsal (`purge.db.test.ts`, „smaže i kontakt, který uživatel
        // mezitím ručně upravil"). Původní věta „na nic ostatního se nesáhne"
        // v tom uživatele naopak utvrzovala.
        t('dialogEdits'),
        // Následující dvě věty se ukážou jen tehdy, když je co ztratit.
        // Nula by v seznamu jen zabírala místo a učila by uživatele seznam
        // přeskakovat.
        ...(impact != null && impact.contacts > 0
          ? [t('dialogImpactContacts', { contacts: impact.contacts })]
          : []),
        ...(impact != null && impact.campaigns > 0
          ? [t('dialogImpactCampaigns', { campaigns: impact.campaigns })]
          : []),
      ]}
      // Sada se dá nahrát znovu jedním kliknutím, takže věta o nevratnosti
      // by tady lhala a příště by ji uživatel přehlédl i tam, kde je pravdivá.
      irreversible={false}
      confirmLabel={t('dialogConfirm')}
      cancelLabel={t('dialogCancel')}
      labels={labels}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
