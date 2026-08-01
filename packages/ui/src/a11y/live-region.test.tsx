import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LiveRegionProvider, useAnnouncer } from './live-region';

function Probe() {
  const announcer = useAnnouncer();
  return (
    <div>
      <button type="button" onClick={() => announcer.polite('Uloženo')}>
        klidně
      </button>
      <button type="button" onClick={() => announcer.assertive('Odesílání selhalo')}>
        naléhavě
      </button>
    </div>
  );
}

describe('LiveRegionProvider', () => {
  it('obě oblasti existují v DOM ještě před prvním hlášením', () => {
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('klidné hlášení jde do polite oblasti', async () => {
    const user = userEvent.setup();
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'klidně' }));
    expect(screen.getByRole('status')).toHaveTextContent('Uloženo');
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });

  it('naléhavé hlášení jde do assertive oblasti', async () => {
    const user = userEvent.setup();
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'naléhavě' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Odesílání selhalo');
  });
});
