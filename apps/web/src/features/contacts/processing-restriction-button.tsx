'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { ShieldCheck } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { liftProcessingRestrictionAction, restrictProcessingAction } from './restriction-actions';

/**
 * Zapnutí a zrušení omezení zpracování podle článku 18 GDPR z detailu kontaktu.
 *
 * Do téhle chvíle se článek 18 nedal v produktu ani zapnout, ani zrušit: doménové
 * funkce `restrictProcessing` a `liftProcessingRestriction` existovaly, ale nevolala
 * je žádná trasa ani obrazovka, takže na detailu stála věta „požádejte správce systému,
 * aby ho odebral". Tohle tlačítko tu větu nahrazuje.
 *
 * OBĚ STRANY MAJÍ OKNO A OBĚ VYŽADUJÍ POZNÁMKU. Zapnutí vyjme člověka ze všech
 * kampaní a zruší zprávy, které na něj čekají; zrušení ho naopak vrátí do rozesílky,
 * a to je rozhodnutí stejné váhy. Poznámka je povinná na serveru (`note` v těle),
 * takže tlačítko bez ní ani neposílá požadavek: server ji zapisuje do metadat auditu
 * a jen z ní se po roce pozná, na základě čeho se zpracování zastavilo nebo rozjelo.
 *
 * Úroveň okna je N2, ne N3: obojí je vratné, takže zaškrtávací políčko „rozumím
 * následkům" by bylo jen překážková dráha (6.2 a 6.7 části 6).
 */
export function ProcessingRestrictionButton({
  workspaceId,
  contactId,
  name,
  mode,
  appearance = 'button',
}: {
  workspaceId: string;
  contactId: string;
  /** Jméno nebo adresa do nadpisu okna, ať je vidět, koho se to týká. */
  name: string;
  /** `restrict` zapíná omezení, `lift` ho ruší. Komponenta kreslí vždy jen jedno tlačítko. */
  mode: 'restrict' | 'lift';
  /**
   * `icon` je čtverec s ikonou a bublinou v řadě akcí v hlavičce obrazovky,
   * `button` je běžné tlačítko se slovem uvnitř žlutého bloku o omezení.
   * Liší se JEN vzhledem: okno, povinné odůvodnění i akce jsou stejné.
   */
  appearance?: 'button' | 'icon';
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const dialogLabels = useConfirmDialogLabels();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  const restricting = mode === 'restrict';

  async function run(): Promise<void> {
    // Poznámka je povinná i tady, ne jen na serveru: dialog by jinak zavřel okno,
    // požadavek by skončil na 422 a uživatel by viděl technický kód místo vysvětlení.
    if (note.trim() === '') return;

    setOpen(false);
    setPending(true);
    const result = restricting
      ? await restrictProcessingAction({ workspaceId, id: contactId, note: note.trim() })
      : await liftProcessingRestrictionAction({ workspaceId, id: contactId, note: note.trim() });
    setPending(false);

    if (result.status === 'error') {
      toast.error(t('detail.actionFailed', { code: result.code }));
      return;
    }
    setNote('');
    toast.success(restricting ? t('restricted.restrictDone') : t('restricted.liftDone'));
    router.refresh();
  }

  const consequences = restricting
    ? [
        t('restricted.restrictConsequenceSegments'),
        t('restricted.restrictConsequenceQueued'),
        t('restricted.restrictConsequenceKeepsData'),
        t('restricted.restrictConsequenceAudit'),
      ]
    : [
        t('restricted.liftConsequenceSending'),
        t('restricted.liftConsequenceSettled'),
        t('restricted.liftConsequenceAudit'),
      ];

  const label = restricting ? t('restricted.restrictAction') : t('restricted.liftAction');
  const testId = restricting ? 'restrict-processing' : 'lift-restriction';

  return (
    <>
      {/* Obě podoby používají `pending`, ne `disabled`: zašedlé tlačítko bez
          vysvětlení je zakázané (kritérium 18 části 6). */}
      {appearance === 'icon' ? (
        <Tooltip content={label}>
          <IconButton
            variant="solid"
            label={label}
            // Bublina říká, co se stane; `title` by nad ní vykreslil druhou,
            // prohlížečovou, takže se vypíná prázdnou hodnotou.
            title=""
            icon={<ShieldCheck aria-hidden className="icon-md" />}
            aria-busy={pending ? true : undefined}
            data-pending={pending ? '' : undefined}
            className="data-[pending]:opacity-60"
            data-testid={testId}
            onClick={() => {
              if (!pending) setOpen(true);
            }}
          />
        </Tooltip>
      ) : (
        <Button
          variant="secondary"
          pending={pending}
          onClick={() => setOpen(true)}
          data-testid={testId}
          className="w-fit"
        >
          {label}
        </Button>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        level="N2"
        title={
          restricting
            ? t('restricted.restrictTitle', { name })
            : t('restricted.liftTitle', { name })
        }
        consequences={consequences}
        // Obojí je vratné: omezení jde zrušit a zase zapnout. Věta „tuhle akci nejde
        // vzít zpět" by tu byla nepravdivá a v dalším okně by ji nikdo nebral vážně.
        irreversible={false}
        note={{
          label: restricting ? t('restricted.restrictNoteLabel') : t('restricted.liftNoteLabel'),
          hint: restricting ? t('restricted.restrictNoteHint') : t('restricted.liftNoteHint'),
          value: note,
          onChange: setNote,
          missingReason: t('restricted.noteMissing'),
        }}
        confirmLabel={restricting ? t('restricted.restrictAction') : t('restricted.liftAction')}
        // Vlastní popisek ústupu, ne obecné „Zrušit". V okně, kde se potvrzuje
        // „Zrušit omezení", by stálo vedle sebe „Zrušit" a „Zrušit omezení", a to
        // jsou dvě tlačítka s opačným významem a skoro stejným textem.
        cancelLabel={t('restricted.dialogCancel')}
        onConfirm={() => void run()}
        labels={dialogLabels}
      />
    </>
  );
}
