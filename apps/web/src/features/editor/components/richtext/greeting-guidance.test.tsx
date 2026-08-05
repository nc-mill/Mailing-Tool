import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCatalog } from '../../model/field-catalog';
import { greetingGuidanceFor } from './greeting-guidance';
import { TokenInspector } from './token-inspector';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'greeting',
      type: 'string',
      label: { cs: 'Oslovení', en: 'Greeting' },
      group: 'salutation',
      deleted: false,
    },
    {
      path: 'first_name_vocative',
      type: 'string',
      label: { cs: 'Křestní jméno v 5. pádu', en: 'First name, vocative' },
      group: 'salutation',
      deleted: false,
    },
    {
      path: 'attr.note',
      type: 'string',
      label: { cs: 'Poznámka', en: 'Note' },
      group: 'custom',
      deleted: false,
    },
  ],
};

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('greetingGuidanceFor', () => {
  it('hotové oslovení pozná', () => {
    expect(greetingGuidanceFor('contact.greeting')).toBe('greeting');
  });

  it('surovinu jména pozná i s filtrem za svislítkem', () => {
    expect(greetingGuidanceFor('contact.first_name_vocative')).toBe('nameFragment');
    expect(greetingGuidanceFor('contact.first_name | default')).toBe('nameFragment');
  });

  it('o ostatních polích nic netvrdí', () => {
    expect(greetingGuidanceFor('contact.email')).toBeNull();
    expect(greetingGuidanceFor('attr.city')).toBeNull();
  });
});

/**
 * Tohle je ta vada z provozu: uživatel v editoru vybral pole „Křestní jméno
 * v 5. pádu", napsal před něj „Dobrý den," a v náhledu dostal 1. pád. Nabídka
 * ani inspektor mu neřekly, že je to surovina a hotovou větu vydává jiné pole.
 */
describe('inspektor značky vysvětlí roli pole', () => {
  it('u suroviny jména varuje před skládáním oslovení', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'contact.first_name_vocative', fallback: null, dateFormat: null }}
      />,
    );
    const warning = screen.getByTestId('token-fragment-warning');
    expect(warning).toHaveTextContent('Tohle je jen jméno, ne oslovení');
    expect(warning).toHaveTextContent('visící čárkou');
    expect(screen.queryByTestId('token-greeting-hint')).toBeNull();
  });

  it('u hotového oslovení řekne, že si poradí i s kontaktem bez jména', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'contact.greeting', fallback: null, dateFormat: null }}
      />,
    );
    expect(screen.getByTestId('token-greeting-hint')).toHaveTextContent('Dobrý den, Petře');
    expect(screen.queryByTestId('token-fragment-warning')).toBeNull();
  });

  it('u běžného pole nevysvětluje nic navíc', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'attr.note', fallback: null, dateFormat: null }}
      />,
    );
    expect(screen.queryByTestId('token-greeting-hint')).toBeNull();
    expect(screen.queryByTestId('token-fragment-warning')).toBeNull();
  });
});
