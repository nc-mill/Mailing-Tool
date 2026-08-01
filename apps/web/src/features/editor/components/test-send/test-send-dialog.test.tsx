import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { createFakePorts } from '../../ports/fake-ports';
import { TestSendDialog } from './test-send-dialog';

function setup(ports = createFakePorts()) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <TestSendDialog
        open
        templateId="t1"
        ports={ports}
        flush={async () => {}}
        onClose={() => {}}
      />
    </NextIntlClientProvider>,
  );
  return ports;
}

describe('TestSendDialog', () => {
  it('odešle na zadané adresy s prefixem předmětu', async () => {
    const ports = createFakePorts();
    const testSend = vi.spyOn(ports, 'testSend');
    setup(ports);
    await userEvent.type(screen.getByLabelText(/Adresy/), 'a@b.cz, c@d.cz');
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    await waitFor(() =>
      expect(testSend).toHaveBeenCalledWith(
        expect.objectContaining({ recipients: ['a@b.cz', 'c@d.cz'], addTestPrefix: true }),
      ),
    );
  });

  it('víc než pět adres nepřijme a řekne proč', async () => {
    setup();
    await userEvent.type(
      screen.getByLabelText(/Adresy/),
      'a@b.cz,b@b.cz,c@b.cz,d@b.cz,e@b.cz,f@b.cz',
    );
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/pět/);
  });

  it('u překročeného limitu ukáže dobu čekání, ne surovou chybu', async () => {
    setup(
      createFakePorts({
        testSend: async () => ({ ok: false, code: 'rate_limited', retryAfter: 900 }),
      }),
    );
    await userEvent.type(screen.getByLabelText(/Adresy/), 'a@b.cz');
    await userEvent.click(screen.getByRole('button', { name: /Poslat test/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/15 minut/);
  });
});
