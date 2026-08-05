'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { confirmContactsAction, type ConfirmOutcome } from './confirm-actions';
import { suppressionReasonKey } from './suppression-affordance';

/**
 * Ruční vrácení odhlášeného kontaktu do rozesílky.
 *
 * NEPOSÍLÁ ŽÁDNÝ E-MAIL A NEČEKÁ NA POTVRZENÍ. Předchozí podoba tlačítka volala
 * `POST /lists/{id}/subscribe`, což je cesta pro PŘIHLÁŠENÍ PŘÍJEMCEM: stavový
 * automat vrací odhlášeného vždy přes `pending` s potvrzovacím odkazem
 * (`state-machine.ts`, větev `from === 'unsubscribed'`). Naměřený důsledek u
 * zadavatele byl trojí a všechno špatně:
 *   1. rozhraní slíbilo e-mail s odkazem, který nikdy nedorazil,
 *   2. kontakt zůstal ve stavu „Odhlášený", takže se zdánlivě nestalo nic,
 *   3. správce vlastní instalace neměl jak vyhovět člověku, který o návrat
 *      požádal telefonem, ačkoliv je to úplně běžná situace.
 *
 * Jde se proto cestou pro VÝSLOVNÉ ROZHODNUTÍ SPRÁVCE, `POST /contacts/{id}/confirm`,
 * pod kterou je v automatu událost `admin_force_confirm`: přechod rovnou na
 * `confirmed`, aktivace kontaktu, udělení souhlasu a záznam do auditu. Tedy přesně
 * to, co zadavatel popsal slovy „prostě ho vrátit ručně, jen s velkým upozorněním".
 *
 * OKNO SE PROTO NEVYNECHÁVÁ. Odhlášení je projev vůle příjemce a přepsat ho je
 * rozhodnutí, za které ručí správce. Okno je jedno, bez opisování textu a bez
 * zaškrtávání; zadavatel chce potvrzení, ne překážkovou dráhu.
 */
export function ResubscribeButton({
  workspaceId,
  contactId,
  /** Kolik seznamů se tím dotkne. Do okna, aby bylo vidět, co se stane. */
  listCount,
}: {
  workspaceId: string;
  contactId: string;
  listCount: number;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const dialogLabels = useConfirmDialogLabels();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  /**
   * ZŮSTÁVAJÍCÍ BLOKACE SE NEHLÁSÍ JAKO ÚSPĚCH, i když se stav opravdu změnil.
   * Blokovaná adresa je vrstva NAD stavem kontaktu a odesílací cesta ji přeskočí
   * bez ohledu na to, že je kontakt aktivní. Táž úvaha jako u ručního potvrzení.
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
    toast.success(t('detail.resubscribeDone'));
    router.refresh();
  }

  async function run() {
    setOpen(false);
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

  return (
    <>
      <Button variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        {pending ? t('statusAction.resubscribing') : t('statusAction.resubscribe')}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        level="N2"
        title={t('statusAction.resubscribeTitle')}
        consequences={[
          t('statusAction.resubscribeWhy'),
          t('statusAction.resubscribeLists', { count: listCount }),
          t('statusAction.resubscribeSending'),
          t('statusAction.resubscribeResponsibility'),
        ]}
        // Vratné to je: člověk se může znovu odhlásit a správce ho může znovu
        // odhlásit za něj. Věta „tuhle akci nejde vzít zpět" by tu byla nepravdivá.
        irreversible={false}
        confirmLabel={t('statusAction.resubscribe')}
        cancelLabel={t('confirmState.dialogCancel')}
        onConfirm={() => void run()}
        labels={dialogLabels}
      />
    </>
  );
}
