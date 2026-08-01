import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useShortcuts } from './use-shortcuts';

function Harness({ handlers }: { handlers: Record<string, () => void> }) {
  useShortcuts(handlers);
  return (
    <div>
      <input aria-label="hledat" />
      <textarea aria-label="poznámka" />
    </div>
  );
}

describe('useShortcuts', () => {
  it('sekvence g pak k přejde na Kontakty', async () => {
    const user = userEvent.setup();
    const goContacts = vi.fn();
    render(<Harness handlers={{ goContacts }} />);
    await user.keyboard('gk');
    expect(goContacts).toHaveBeenCalledTimes(1);
  });

  it('jednopísmenné zkratky se ignorují, když je fokus v textovém poli', async () => {
    const user = userEvent.setup();
    const goContacts = vi.fn();
    const { getByLabelText } = render(<Harness handlers={{ goContacts }} />);
    await user.click(getByLabelText('hledat'));
    await user.keyboard('gk');
    expect(goContacts).not.toHaveBeenCalled();
  });

  it('Ctrl nebo Cmd plus K otevře vyhledávání i z textového pole', async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    const { getByLabelText } = render(<Harness handlers={{ search }} />);
    await user.click(getByLabelText('hledat'));
    await user.keyboard('{Control>}k{/Control}');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('sekvence vyprší, když je pauza příliš dlouhá', async () => {
    vi.useFakeTimers();
    const goContacts = vi.fn();
    render(<Harness handlers={{ goContacts }} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    vi.advanceTimersByTime(2000);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(goContacts).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('otazník otevře přehled zkratek', async () => {
    const user = userEvent.setup();
    const help = vi.fn();
    render(<Harness handlers={{ help }} />);
    await user.keyboard('?');
    expect(help).toHaveBeenCalledTimes(1);
  });
});
