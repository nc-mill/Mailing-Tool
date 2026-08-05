import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import type { ReactElement } from 'react';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csContacts from '../../../../../packages/i18n/messages/cs/contacts.json';
import csForms from '../../../../../packages/i18n/messages/cs/forms.json';

/**
 * Obrazovky formulářů čtou tři katalogy: `contacts` (texty formulářů a vkládání,
 * které tam byly od začátku), vlastní `forms` a `common` (popisky tabulky,
 * potvrzovacího dialogu a obecných akcí).
 *
 * Zóna je v poskytovateli, ne v komponentě: server ani prohlížeč si ji nesmí
 * dopočítat sám, jinak vznikne nesoulad hydratace, který React neopraví.
 */
export const MESSAGES = { common: csCommon, contacts: csContacts, forms: csForms };

export function withProviders(ui: ReactElement): ReactElement {
  return (
    <NextIntlClientProvider
      locale="cs"
      messages={MESSAGES}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <TooltipProvider>{ui}</TooltipProvider>
    </NextIntlClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(withProviders(ui));
}
