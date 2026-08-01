'use client';

import { useTranslations } from 'next-intl';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import type { ReactNode } from 'react';

/**
 * `useToast` z P05 mimo `ToastProvider` vyhodí výjimku a skořápka projektu
 * (`w/[workspaceSlug]/layout.tsx`, vlastní ji P05) poskytovatele nemontuje.
 * Naměřeno v prohlížeči: `/settings/members` vracel 500 s hláškou
 * „useToast se smí volat jen uvnitř ToastProvider".
 *
 * Sekce nastavení si ho proto zapíná sama ve svém layoutu, stejně jako to
 * dělá doména kontaktů. Až ho skořápka dostane, tenhle soubor zmizí.
 */
export function SettingsToasts({ children }: { children: ReactNode }) {
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
      {children}
    </ToastProvider>
  );
}
