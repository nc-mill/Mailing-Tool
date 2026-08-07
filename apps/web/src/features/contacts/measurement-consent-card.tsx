'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardHeader } from '@mlain/ui/components/card';
import { useToast } from '@mlain/ui/patterns/toast';
import { setMeasurementConsentAction } from './measurement-consent-actions';
import type { MeasurementConsent } from './measurement-consent-state';

/**
 * Blok „Měření chování" na detailu kontaktu.
 *
 * TŘI HODNOTY, NE PŘEPÍNAČ. `not_recorded` znamená, že se ten člověk k měření
 * nikdy nevyjádřil, a to není totéž jako „souhlasil" ani „odmítl". Přepínač má
 * jen dvě polohy, takže by jednu z nich musel předstírat: buď by tvrdil
 * souhlas, který nikdo nedal, nebo odmítnutí, o které nikdo nepožádal.
 * Obojí je na obrazovce o souhlasech nepřijatelné.
 *
 * Vysvětlení stojí VEDLE STAVU, ne v potvrzovacím okně. Samotné „Souhlas
 * s měřením: zapnuto" nikomu neřekne, co se měří ani co se stane po vypnutí,
 * a schovat to do okna znamená, že si to přečte jen ten, kdo už na tlačítko
 * sáhl. Kdo se jen dívá, se to má dozvědět taky.
 */
export function MeasurementConsentCard({
  workspaceId,
  contactId,
  consent,
  consentHistoryHref,
  /**
   * Smazaný nebo anonymizovaný kontakt: stav se ukáže, měnit ho nejde.
   * Stejné pravidlo jako u ostatních akcí na téhle obrazovce.
   */
  readOnly,
}: {
  workspaceId: string;
  contactId: string;
  consent: MeasurementConsent;
  consentHistoryHref: string;
  readOnly: boolean;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const withdrawn = consent === 'withdrawn';

  async function run(status: 'granted' | 'withdrawn'): Promise<void> {
    setPending(true);
    const result = await setMeasurementConsentAction({ workspaceId, id: contactId, status });
    setPending(false);
    if (result.status === 'error') {
      toast.error(t('detail.actionFailed', { code: result.code }));
      return;
    }
    toast.success(
      status === 'withdrawn' ? t('measurement.withdrawDone') : t('measurement.grantDone'),
    );
    router.refresh();
  }

  /**
   * Následky se vypisují u OBOU poloh. U vypnutého měření je stejně důležité
   * vědět, co se tím zastavilo, jako u zapnutého vědět, co se sbírá: uživatel
   * jinak hledá v reportu chybu, která je ve skutečnosti splněným přáním
   * toho člověka.
   */
  const consequences = withdrawn
    ? [
        t('measurement.offConsequenceWeb'),
        t('measurement.offConsequenceEmail'),
        t('measurement.offConsequenceHistory'),
        t('measurement.offConsequenceCampaign'),
      ]
    : [
        t('measurement.onConsequenceWeb'),
        t('measurement.onConsequenceEmail'),
        t('measurement.onConsequenceGate'),
      ];

  return (
    <Card data-testid="measurement-consent">
      <CardHeader title={t('measurement.title')} />

      <p data-testid="measurement-state" className="text-ui font-semibold text-text">
        {withdrawn
          ? t('measurement.stateWithdrawn')
          : consent === 'granted'
            ? t('measurement.stateGranted')
            : t('measurement.stateNotRecorded')}
      </p>

      {/* Věta o tom, odkud se stav bere. Bez ní si uživatel u „Nezaznamenáno"
          přečte, že se neměří, přestože se měřit může: souhlas návštěvníka
          sbírá lišta na jeho vlastním webu a tenhle záznam je až nad ní. */}
      <p className="text-sm text-text-muted">
        {withdrawn
          ? t('measurement.explainWithdrawn')
          : consent === 'granted'
            ? t('measurement.explainGranted')
            : t('measurement.explainNotRecorded')}
      </p>

      <ul className="ml-4 list-disc text-sm text-text-muted">
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
          {/*
            Vypnutí je běžná akce, zapnutí je ZÁZNAM CIZÍHO PROJEVU VŮLE, a proto
            se jmenují jinak. Obrazovka historie souhlasů odmítá zakládat souhlas
            kliknutím správce a má pravdu: souhlas dává ten člověk, ne my. Cesta
            zpátky tu ale být musí, jinak jeden překlep trvale ubere kontaktu
            měření a nikdo to nevrátí. Popisek proto říká, co se doopravdy zapíše,
            a v historii souhlasů je ten zápis vidět i s časem.
          */}
          <Button
            variant={withdrawn ? 'primary' : 'secondary'}
            pending={pending}
            data-testid={withdrawn ? 'measurement-grant' : 'measurement-withdraw'}
            onClick={() => void run(withdrawn ? 'granted' : 'withdrawn')}
          >
            {withdrawn ? t('measurement.grantAction') : t('measurement.withdrawAction')}
          </Button>
          {/* Vlastní popisek, ne `detail.consentHistory`. Blok o původu odkazuje
              na tutéž obrazovku a dva odkazy se stejným textem vedle sebe se
              nedají odlišit ani očima, ani odečítačem. */}
          <Link href={consentHistoryHref} className="text-sm">
            {t('measurement.historyAction')}
          </Link>
        </div>
      )}
    </Card>
  );
}
