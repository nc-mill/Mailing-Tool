import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import type { ReactElement } from 'react';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import csEditor from '../../../../../packages/i18n/messages/cs/editor.json';
import csContacts from '../../../../../packages/i18n/messages/cs/contacts.json';
import csForms from '../../../../../packages/i18n/messages/cs/forms.json';

/**
 * Obrazovky formulářů čtou čtyři katalogy: `contacts` (texty formulářů a vkládání,
 * které tam byly od začátku), vlastní `forms`, `common` (popisky tabulky,
 * potvrzovacího dialogu a obecných akcí) a `editor`, odkud se berou jména
 * pevných polí kontaktu (`useContactTargetLabel`). Bez toho čtvrtého by stavěč
 * polí vypsal syrový klíč `editor.field.firstName`, a to je přesně ta vada,
 * kterou má pojmenování odstranit.
 *
 * Zóna je v poskytovateli, ne v komponentě: server ani prohlížeč si ji nesmí
 * dopočítat sám, jinak vznikne nesoulad hydratace, který React neopraví.
 */
export const MESSAGES = {
  common: csCommon,
  contacts: csContacts,
  editor: csEditor,
  forms: csForms,
};

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
