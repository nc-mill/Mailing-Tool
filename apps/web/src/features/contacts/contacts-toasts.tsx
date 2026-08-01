'use client';

import { useTranslations } from 'next-intl';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import type { ReactNode } from 'react';

/**
 * `useToast` z P05 mimo `ToastProvider` vyhodí výjimku a `Tooltip` mimo
 * `TooltipProvider` taky. Skořápka projektu (`w/[workspaceSlug]/layout.tsx`,
 * vlastní ji P05) nemontuje ani jednoho, takže si je obrazovky domény kontaktů
 * zapínají samy ve svém `layout.tsx`. Ověřeno spuštěním: bez toho spadne detail
 * kontaktu na výjimce „Tooltip must be used within TooltipProvider".
 * Až je skořápka dostane, tenhle soubor zmizí a nic jiného se měnit nebude.
 */
export function ContactsToasts({ children }: { children: ReactNode }) {
  const t = useTranslations('common');

  return (
    <ToastProvider
      labels={{
        undo: t('actions.undo'),
        close: t('actions.close'),
        notifications: t('a11y.notifications'),
        countdown: (seconds: number) => t('feedback.undoCountdown', { seconds }),
        repeated: (message: string, count: number) => t('feedback.repeated', { message, count }),
      }}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </ToastProvider>
  );
}
