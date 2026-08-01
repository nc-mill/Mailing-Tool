import { render, screen } from '@testing-library/react';
import messages from '@mlain/i18n/messages/cs/editor.json';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BlockPreview } from './block-preview';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('BlockPreview', () => {
  it('nadpis kreslí jako text s úrovní', () => {
    wrap(
      <BlockPreview
        canWriteHtml
        block={{
          id: 'b_1',
          type: 'heading',
          props: {
            level: 1,
            content: [{ t: 'p', children: [{ t: 's', v: 'Letní výprodej' }] }],
          },
        }}
      />,
    );
    expect(screen.getByText('Letní výprodej')).toBeInTheDocument();
  });

  it('personalizaci kreslí jako žeton s popiskem, ne jako Liquid', () => {
    wrap(
      <BlockPreview
        canWriteHtml
        block={{
          id: 'b_1',
          type: 'text',
          props: {
            content: [{ t: 'p', children: [{ t: 'var', expr: 'contact.greeting' }] }],
          },
        }}
      />,
    );
    expect(screen.getByTestId('token')).toHaveTextContent('Oslovení');
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it('obrázek bez alt textu ukáže varování rovnou na plátně', () => {
    wrap(
      <BlockPreview
        canWriteHtml
        block={{ id: 'b_1', type: 'image', props: { assetId: 'a1', alt: '', decorative: false } }}
      />,
    );
    expect(screen.getByTestId('missing-alt')).toBeInTheDocument();
  });

  it('blok html bez oprávnění ukáže vysvětlení, ne prázdno', () => {
    wrap(
      <BlockPreview
        canWriteHtml={false}
        block={{ id: 'b_1', type: 'html', props: { code: '<b>x</b>' } }}
      />,
    );
    expect(screen.getByTestId('html-forbidden')).toBeInTheDocument();
  });
});
