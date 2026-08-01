'use client';

import { useTranslations } from 'next-intl';
import type { ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';

/**
 * Popisky, které `ConfirmDialog` potřebuje nezávisle na tom, co potvrzuje.
 *
 * `notYetConfirmed` a `notYetTyped` jsou vysvětlení místo zašednutí:
 * potvrzovací tlačítko **nikdy nemá `disabled`** (kritérium 18 kapitoly
 * 15.2 části 6), takže když se opsaná fráze neshoduje, dialog neztmavne,
 * ale řekne, co ještě chybí.
 */
export function useConfirmDialogLabels(): ConfirmDialogLabels {
  const t = useTranslations('settings');

  return {
    irreversible: t('confirm.irreversible'),
    whatHappens: t('confirm.whatHappens'),
    notYetConfirmed: t('confirm.notYetConfirmed'),
    notYetTyped: t('confirm.notYetTyped'),
    typeToConfirmMismatch: t('confirm.typeToConfirmMismatch'),
    filterInWords: (filter: string) => t('confirm.filterInWords', { filter }),
  };
}
