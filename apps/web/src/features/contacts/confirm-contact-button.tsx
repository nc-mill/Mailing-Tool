'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { confirmContactsAction, type ConfirmOutcome } from './confirm-actions';
import { needsConfirmDialog, offersManualConfirm } from './confirm-state';
import { suppressionReasonKey } from './suppression-affordance';

export type ConfirmContactButtonProps = {
  /** Bez něj běží požadavek mimo kontext projektu a RLS vrátí 404. */
  workspaceId: string;
  contactId: string;
  /** Stav kontaktu. Rozhoduje o tom, jestli se akce nabídne a jestli přes dialog. */
  status: string;
  /**
   * Adresa kontaktu. Vyplňuje ji seznam kontaktů, kde je v jednom sloupci deset stejně
   * pojmenovaných tlačítek a bez adresy by je odečítač obrazovky nerozlišil.
   */
  email?: string | undefined;
  /**
   * `detail` je tlačítko s vysvětlením pod ním, `row` je kompaktní ovládání v řádku
   * seznamu kontaktů. Liší se JEN vzhledem, chování je stejné.
   */
  variant?: 'detail' | 'row';
};

/**
 * Ruční povýšení JEDNOHO kontaktu na potvrzený.
 *
 * NABÍDNE SE U KAŽDÉHO KONTAKTU, KTERÝ POTVRZENÝ NENÍ A NENÍ ODHLÁŠENÝ. Dřív se
 * u nepotvrzených stavů nevykreslila vůbec a rozhraní hlásilo, že to nejde, protože
 * zápis takový stav mlčky zachoval. Server dnes má pro výslovné rozhodnutí správce
 * vlastní cestu (`POST /contacts/{id}/confirm`), takže tvrzení „nejde to" zmizelo.
 *
 * Odhlášený kontakt akci nedostává schválně a rozhoduje o tom `confirm-state.ts`, kde
 * je i důvod: potvrzený už byl, jinak by se neměl jak odhlásit. Patří k němu „přihlásit
 * zpět", ne „označit jako potvrzený".
 *
 * DIALOG JEN TAM, KDE MĚNÍ ROZHODNUTÍ ČLOVĚKA, tedy u stížnosti na spam. Jedno okno
 * řekne, co se stane, a tím to končí. U ostatních stavů je to jedno kliknutí bez okna.
 */
export function ConfirmContactButton({
  workspaceId,
  contactId,
  status,
  email,
  variant = 'detail',
}: ConfirmContactButtonProps) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const dialogLabels = useConfirmDialogLabels();
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!offersManualConfirm(status)) return null;

  const needsDialog = needsConfirmDialog(status);

  /**
   * Vyhodnocení výsledku. ZŮSTÁVAJÍCÍ BLOKACE SE NEHLÁSÍ JAKO ÚSPĚCH, přestože se stav
   * opravdu změnil: stav kontaktu není jediná brána a odesílací cesta zablokovanou adresu
   * přeskočí bez ohledu na něj. Oznámení chybové barvy se navíc nezavírá samo, takže
   * uživateli nezmizí pod rukama.
   */
  function report(outcome: ConfirmOutcome): void {
    if (outcome.suppressionBlocking !== null) {
      toast.error(
        t('confirmState.stillBlocked', {
          reason: t(suppressionReasonKey(outcome.suppressionBlocking)),
        }),
      );
      router.refresh();
      return;
    }
    toast.success(t('confirmState.done', { count: 1 }));
    router.refresh();
  }

  async function confirm() {
    setDialogOpen(false);
    setPending(true);
    const result = await confirmContactsAction({ workspaceId, ids: [contactId] });
    setPending(false);
    if (result.status === 'error') {
      toast.error(t('confirmState.failed', { detail: result.code }));
      return;
    }
    const outcome = result.outcomes[0];
    if (outcome === undefined) return;
    report(outcome);
  }

  const label = pending ? t('confirmState.confirming') : t('confirmState.action');

  const button = (
    <Button
      variant="secondary"
      disabled={pending}
      {...(email === undefined ? {} : { 'aria-label': t('confirmState.actionFor', { email }) })}
      onClick={() => {
        if (needsDialog) {
          setDialogOpen(true);
          return;
        }
        void confirm();
      }}
    >
      {label}
    </Button>
  );

  return (
    <>
      {variant === 'row' ? (
        button
      ) : (
        <div className="flex flex-col items-start gap-1">
          {button}
          <p className="text-sm text-text-muted">{t('confirmState.hint')}</p>
        </div>
      )}

      {needsDialog ? (
        <ConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          // N2: jedno okno se souhrnem následků, bez zaškrtávání a bez opisování textu.
          // Zadavatel chce jedno potvrzení, ne překážkovou dráhu.
          level="N2"
          title={t('confirmState.dialogTitle')}
          consequences={[
            t('confirmState.dialogWhyComplained'),
            t('confirmState.dialogSending'),
            t('confirmState.dialogLists'),
            t('confirmState.dialogStaysBlocked'),
          ]}
          // Povýšení není nevratné: adresu jde znovu zablokovat a člověk se může znovu
          // odhlásit. Věta „Tuhle akci nejde vzít zpět" by tu byla nepravdivá.
          irreversible={false}
          confirmLabel={t('confirmState.action')}
          cancelLabel={t('confirmState.dialogCancel')}
          onConfirm={() => void confirm()}
          labels={dialogLabels}
        />
      ) : null}
    </>
  );
}
