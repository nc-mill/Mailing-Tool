// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { SecretReveal } from './secret-reveal';

const messages = { settings: csSettings };
const SECRET = 'ml_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA';

function renderReveal(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SecretReveal
        secret={SECRET}
        titleKey="apiKeys.secret.title"
        warningKey="apiKeys.secret.warning"
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
}

describe('SecretReveal', () => {
  it('použije doslovnou hlášku ze specifikace', () => {
    renderReveal();
    expect(
      screen.getByText('Zkopírujte si sekret teď. Už ho nikdy neuvidíme ani my.'),
    ).toBeInTheDocument();
  });

  it('ukáže celý sekret, ne zkrácený', () => {
    renderReveal();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it('nabídne zkopírování sekretu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderReveal();
    await userEvent.click(screen.getByRole('button', { name: 'Zkopírovat' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it('zavření vyžaduje potvrzení, že si sekret uživatel uložil', async () => {
    const onClose = vi.fn();
    renderReveal(onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Hotovo' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Sekret mám uložený'));
    await userEvent.click(screen.getByRole('button', { name: 'Hotovo' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tlačítko Hotovo nemá disabled ani před zaškrtnutím', () => {
    renderReveal();
    expect(screen.getByRole('button', { name: 'Hotovo' })).not.toHaveAttribute('disabled');
  });

  it('je oznámené čtečce obrazovky', () => {
    renderReveal();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
