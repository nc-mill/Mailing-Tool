import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './toast-provider';

const labels = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} ×${count}`,
};

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.info('Uloženo')}>
        info
      </button>
      <button type="button" onClick={() => toast.error('Kontakt se nepodařilo odebrat.')}>
        chyba
      </button>
      <button
        type="button"
        onClick={() => toast.undoable({ message: 'Kontakt odebrán', onUndo: onUndo ?? (() => {}) })}
      >
        vratná
      </button>
    </div>
  );
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * REGRESE: v prohlížeči oznámení nikdy nezmizela, přestože testy skladiště
   * odpočet měřily správně.
   *
   * `next.config.ts` má `reactStrictMode: true`. React ve StrictModu po prvním
   * připojení schválně spustí úklid efektů a hned je připojí znovu. Úklid
   * `useEffect(() => () => store.destroy(), [store])` tím zabil tikající interval
   * dřív, než kdokoli stačil první oznámení vyvolat, a druhé připojení už ho
   * nemělo jak obnovit. Skladiště proto musí `destroy()` přežít: tikání se
   * rozjíždí líně podle toho, jestli je co odpočítávat.
   *
   * Test montuje do `StrictMode` schválně, jinak by ta situace nikdy nenastala.
   */
  it('odpočet běží i ve StrictModu, kde React zavolá úklid efektu hned po připojení', () => {
    vi.useFakeTimers();
    render(
      <StrictMode>
        <ToastProvider labels={labels}>
          <Trigger />
        </ToastProvider>
      </StrictMode>,
    );
    act(() => {
      screen.getByRole('button', { name: 'info' }).click();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Uloženo');
    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('informaci oznámí přes role=status, chybu přes role=alert', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('status')).toHaveTextContent('Uloženo');

    await user.click(screen.getByRole('button', { name: 'chyba' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Kontakt se nepodařilo odebrat.');
  });

  it('oblast oznámení je v DOM ještě před prvním toastem', () => {
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    expect(screen.getByLabelText('Oznámení')).toBeInTheDocument();
  });

  it('u vratné akce ukazuje odpočet a tlačítko Vrátit zpět', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'vratná' }));
    expect(screen.getByRole('button', { name: 'Vrátit zpět' })).toBeVisible();
    expect(screen.getByText(/Zbývá 10 s/)).toBeVisible();
  });

  it('Alt + Z vrátí poslední vratnou akci bez myši', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <ToastProvider labels={labels}>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'vratná' }));
    await user.keyboard('{Alt>}z{/Alt}');
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('Esc zavře nejnovější toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'chyba' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('každý toast má tlačítko zavřít', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('button', { name: 'Zavřít' })).toBeVisible();
  });
});
