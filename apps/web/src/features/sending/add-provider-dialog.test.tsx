import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddProviderDialog } from './add-provider-dialog';
import { renderWithProviders } from '../campaigns/test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

/**
 * Nápověda k dialogu pro nový odesílací účet.
 *
 * Testuje se tu jedna naměřená vada: „připojení odesílatele SES je naprosto
 * bez jakéhokoli vysvětlení, kde mám údaje získat". Tvrzení proto míří na
 * obsah, ne na existenci komponenty: musí být vidět postup, vysvětlení
 * jednotlivých kolonek, odkazy do dokumentace Amazonu a upozornění
 * na pískoviště.
 */
function renderDialog() {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue({ status: 'success', providerId: 'p9' });
  renderWithProviders(<AddProviderDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  return { onOpenChange, onSubmit };
}

describe('nápověda v dialogu pro nový odesílací účet', () => {
  it('nabízí rozbalovací návod, který je zavřený a dá se otevřít', async () => {
    renderDialog();
    const trigger = screen.getByRole('button', { name: /Kde v AWS tyhle údaje vezmu/ });

    // Zavřená nápověda nesmí zabírat místo, jinak by dialog narostl do nepoužitelné délky.
    expect(screen.queryByText('Postup krok za krokem')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByText('Postup krok za krokem')).toBeInTheDocument();
  });

  it('u SES vysvětlí postup v konzoli AWS včetně klíče, který se ukáže jen jednou', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Kde v AWS tyhle údaje vezmu/ }));
    const help = screen.getByTestId('provider-help');

    expect(within(help).getByText(/Přihlaste se do konzole AWS/)).toBeInTheDocument();
    expect(within(help).getByText(/otevřete službu IAM/)).toBeInTheDocument();
    expect(
      within(help).getByText(/Tajný klíč uvidíte jen na téhle jediné obrazovce/),
    ).toBeInTheDocument();
    // Zkratka regionu z adresního řádku konzole je to, co uživatel sám nevydedukuje.
    expect(within(help).getByText(/region=eu-central-1/)).toBeInTheDocument();
  });

  it('u SES popíše všechny čtyři kolonky, které formulář chce', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Kde v AWS tyhle údaje vezmu/ }));
    const help = screen.getByTestId('provider-help');

    for (const term of ['Region', 'Access key ID', 'Secret access key', 'Konfigurační sada']) {
      expect(within(help).getByText(term)).toBeInTheDocument();
    }
  });

  it('u SES odkazuje na skutečné stránky dokumentace Amazonu v nové kartě', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Kde v AWS tyhle údaje vezmu/ }));
    const links = within(screen.getByTestId('provider-help')).getAllByRole('link');

    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
    expect(
      links.some(
        (link) =>
          link.getAttribute('href') ===
          'https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html',
      ),
    ).toBe(true);
  });

  it('varování o testovacím režimu SES je vidět bez rozbalení nápovědy', () => {
    renderDialog();
    const notice = screen.getByTestId('provider-sandbox-notice');

    expect(notice).toHaveAttribute('data-tone', 'warning');
    // Název stavu drží závazný slovník 9.2, ne doslovný překlad z konzole AWS.
    expect(notice).toHaveTextContent('testovacím režimu u Amazonu');
    expect(notice).toHaveTextContent(/jen na adresy a domény ověřené přímo v SES/);
    expect(notice).toHaveTextContent(/200 zpráv za 24 hodin/);
  });

  it('rozbalená nápověda říká, jak se o produkční přístup žádá', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Kde v AWS tyhle údaje vezmu/ }));

    expect(
      within(screen.getByTestId('provider-help')).getByText(/Request production access/),
    ).toBeInTheDocument();
  });

  it('po přepnutí na SMTP se nápověda vymění a vysvětlí port i šifrování', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /Vlastní SMTP/ }));

    // Pískoviště je věc SES, u SMTP nemá co dělat.
    expect(screen.queryByTestId('provider-sandbox-notice')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Kde tyhle údaje vezmu?' }));
    const help = screen.getByTestId('provider-help');

    for (const term of ['Server', 'Port', 'Uživatelské jméno', 'Heslo', 'Šifrování']) {
      expect(within(help).getByText(term)).toBeInTheDocument();
    }
    expect(within(help).getByText(/STARTTLS naváže nešifrované spojení/)).toBeInTheDocument();
    expect(within(help).getByText(/heslo pro aplikaci/)).toBeInTheDocument();
  });
});
