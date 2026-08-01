import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import type { ReactElement } from 'react';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csContacts from '../../../../../packages/i18n/messages/cs/contacts.json';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';

/**
 * Obrazovky domény kontaktů čtou tři katalogy: vlastní `contacts`, obecné popisky
 * potvrzovacího dialogu a chybového bloku z `settings` a popisky oznámení z `common`.
 * `useToast` mimo `ToastProvider` navíc vyhodí výjimku, takže ho testy montují taky.
 */
export const MESSAGES = { common: csCommon, contacts: csContacts, settings: csSettings };

export const TOAST_LABELS = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} (${count})`,
};

export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider
      locale="cs"
      messages={MESSAGES}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <TooltipProvider>
        <ToastProvider labels={TOAST_LABELS}>{ui}</ToastProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}
