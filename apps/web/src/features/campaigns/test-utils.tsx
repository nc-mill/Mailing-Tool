import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import type { ReactElement } from 'react';
import csCampaigns from '../../../../../packages/i18n/messages/cs/campaigns.json';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';

/**
 * Obrazovky kampaní a nastavení odesílání čtou tři katalogy: vlastní `campaigns`,
 * popisky tabulky a potvrzovacího dialogu z `common` a chybový blok ze `settings`.
 *
 * Zóna je v poskytovateli, ne v komponentě: server ani prohlížeč si ji nesmí
 * dopočítat sám, jinak vznikne nesoulad hydratace, který React neopraví.
 */
export const MESSAGES = { campaigns: csCampaigns, common: csCommon, settings: csSettings };

/**
 * Popisky oznámení. `useToast` mimo `ToastProvider` vyhodí výjimku, takže ho
 * testy montují taky: přejmenování kampaně v hlavičce jím hlásí, že se uložilo.
 */
export const TOAST_LABELS = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} (${count})`,
};

/**
 * Obal s poskytovateli zvlášť, protože `rerender` z testing-library nahrazuje
 * CELÝ strom. Bez obalu by se při něm ztratil katalog i formáty a komponenta
 * by spadla na chybějícím kontextu, ne na tvrzení testu.
 */
export function withProviders(ui: ReactElement): ReactElement {
  return (
    <NextIntlClientProvider
      locale="cs"
      messages={MESSAGES}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <TooltipProvider>
        <ToastProvider labels={TOAST_LABELS}>{ui}</ToastProvider>
      </TooltipProvider>
    </NextIntlClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(withProviders(ui));
}
