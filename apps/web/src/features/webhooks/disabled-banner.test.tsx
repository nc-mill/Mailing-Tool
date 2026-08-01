// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { DisabledBanner } from './disabled-banner';

const messages = { settings: csSettings };

function renderBanner(detail = true) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DisabledBanner
        url="https://eshop.cz/hooks/mlain"
        lastStatus={500}
        since="2026-07-29T08:00:00.000Z"
        withDetail={detail}
        onEnable={vi.fn()}
        endpointHref="/w/eshop/settings/webhooks/w1"
      />
    </NextIntlClientProvider>,
  );
}

describe('DisabledBanner', () => {
  it('v seznamu použije krátký doslovný text ze specifikace', () => {
    renderBanner(false);
    expect(
      screen.getByText(
        'Váš webhook jsme vypnuli po 20 neúspěšných pokusech. Opravte cíl a zapněte ho znovu.',
      ),
    ).toBeInTheDocument();
  });

  it('v detailu doplní adresu, stavový kód a datum', () => {
    renderBanner(true);
    expect(screen.getByText(/https:\/\/eshop\.cz\/hooks\/mlain/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('slibuje přehrání posledních 24 hodin a říká, co se doposlat nedá', () => {
    renderBanner(true);
    expect(screen.getByText(/přehrání událostí za posledních 24 hodin/)).toBeInTheDocument();
    expect(screen.getByText(/Co je starší, se doposlat nedá/)).toBeInTheDocument();
  });

  it('nabídne obě akce z hlášky 25', () => {
    renderBanner(true);
    expect(screen.getByRole('link', { name: 'Zobrazit poslední chyby' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapnout znovu' })).toBeInTheDocument();
  });

  it('stav nesděluje jen barvou, ale i slovem', () => {
    renderBanner(true);
    expect(screen.getByText('Váš webhook jsme vypnuli')).toBeInTheDocument();
  });

  it('drží kód v data-error-code kvůli testům', () => {
    const { container } = renderBanner(true);
    expect(container.querySelector('[data-error-code="webhook_endpoint_disabled"]')).not.toBeNull();
  });
});
