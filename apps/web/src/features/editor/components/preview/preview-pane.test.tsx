import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { createFakePorts } from '../../ports/fake-ports';
import { PreviewPane } from './preview-pane';

function setup(ports = createFakePorts()) {
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <PreviewPane templateId="t1" ports={ports} flush={async () => {}} />
    </NextIntlClientProvider>,
  );
  return ports;
}

describe('PreviewPane', () => {
  it('má čtyři režimy a k tomu nezávislý přepínač tmavého režimu', async () => {
    setup();
    for (const label of ['Počítač', 'Mobil', 'Textová verze', 'Zdroj']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('switch', { name: /Tmavý režim/ })).toBeInTheDocument();
  });

  it('přepnutí tmavého režimu nevolá server znovu', async () => {
    // Tmavý režim kreslí komponenta K6 v prohlížeči. Kdyby byl v závislostech
    // načítání, každé cvaknutí by znamenalo cestu na server a probliknutí náhledu.
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('switch', { name: /Tmavý režim/ }));
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('kreslí náhled v iframe se šířkou podle režimu', async () => {
    setup();
    await waitFor(() => expect(screen.getByTitle(/Náhled/)).toBeInTheDocument());
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '700');
    await userEvent.click(screen.getByRole('radio', { name: 'Mobil' }));
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('data-width', '375');
  });

  it('tlačítko Kontakt bez jména vyžádá náhled s prázdnými osobními údaji, kritérium 55', async () => {
    const ports = createFakePorts();
    const preview = vi.spyOn(ports, 'preview');
    setup(ports);
    await userEvent.click(screen.getByRole('button', { name: /Kontakt bez jména/ }));
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ previewData: { type: 'sample', variant: 'no_name' } }),
      ),
    );
  });

  it('před vyžádáním náhledu dopíše rozdělanou změnu na server', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <PreviewPane templateId="t1" ports={createFakePorts()} flush={flush} />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(flush).toHaveBeenCalled());
  });

  it('textová verze se zobrazí jako text, ne jako HTML', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Textová verze' }));
    await waitFor(() => expect(screen.getByTestId('preview-text')).toHaveTextContent('Dobrý den'));
  });
});
