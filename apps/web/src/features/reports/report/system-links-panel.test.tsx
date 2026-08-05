// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { SystemLinksPanel, type SystemLinkClicks } from './system-links-panel';

/**
 * Zadavatel klikl v e-mailu na „Nastavit předvolby" a report ukazoval nulu.
 * Klik se měřil, jen se neměl kde ukázat. Tenhle panel je to místo a musí
 * zůstat MIMO míru prokliku: odhlášení není zájem o sdělení.
 */
const messages = { reports: csReports };

function renderPanel(clicks: SystemLinkClicks | null) {
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SystemLinksPanel clicks={clicks} />
    </NextIntlClientProvider>,
  );
}

describe('SystemLinksPanel', () => {
  it('ukáže počty po druzích odkazu', () => {
    renderPanel({ unsubscribe_page: 1, preferences: 3, webview: 2 });

    expect(screen.getByTestId('system-links-preferences')).toHaveTextContent('3');
    expect(screen.getByTestId('system-links-unsubscribe_page')).toHaveTextContent('1');
    expect(screen.getByTestId('system-links-webview')).toHaveTextContent('2');
  });

  it('vždycky připomene, že to není součást míry prokliku', () => {
    renderPanel({ unsubscribe_page: 0, preferences: 3, webview: 0 });

    expect(screen.getByText(csReports.report.systemLinks.notInClickRate)).toBeVisible();
  });

  it('u samých nul je to pravdivá nula, ne chybějící údaj', () => {
    renderPanel({ unsubscribe_page: 0, preferences: 0, webview: 0 });

    expect(screen.getByText(csReports.report.systemLinks.none)).toBeVisible();
  });

  it('dokud čísla nedorazila, nekreslí prázdný panel', () => {
    renderPanel(null);

    expect(screen.queryByTestId('system-links-panel')).toBeNull();
  });
});
