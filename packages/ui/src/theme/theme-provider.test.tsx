import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPreference('dark')}>
        tmavý
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        systém
      </button>
    </div>
  );
}

function mockPrefersDark(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    mockPrefersDark(false);
  });

  it('výchozí předvolba je systém a řídí se prefers-color-scheme', () => {
    mockPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('výslovná volba přebije systém', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'tmavý' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('návrat na systém vrátí odvozenou hodnotu', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'systém' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('mimo poskytovatele vyhodí srozumitelnou chybu', () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
