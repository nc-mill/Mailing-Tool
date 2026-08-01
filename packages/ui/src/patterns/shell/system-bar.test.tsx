import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemBar, type SystemBarState } from './system-bar';

const offline: SystemBarState = { kind: 'offline', message: 'Ztratili jsme spojení.' };
const trial: SystemBarState = { kind: 'trialMode', message: 'Zkušební režim.' };
const sending: SystemBarState = { kind: 'campaignRunning', message: 'Rozesílka 3 214 z 12 480.' };
const blocked: SystemBarState = { kind: 'sendingBlocked', message: 'Odesílání je zastavené.' };
const backup: SystemBarState = { kind: 'backupExpiring', message: 'Záloha za 5 dní vyprší.' };

describe('SystemBar', () => {
  it('zobrazuje nejvýš jeden stav', () => {
    render(<SystemBar states={[trial, offline, sending]} />);
    expect(screen.getAllByTestId('system-bar')).toHaveLength(1);
  });

  it('vyhrává stav s nižším pořadím', () => {
    render(<SystemBar states={[trial, offline, sending]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'offline');
  });

  it('zablokované odesílání přebije všechno', () => {
    render(<SystemBar states={[offline, blocked, sending]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'sendingBlocked');
  });

  it('varování o záloze je nad zkušebním režimem, jinak by ho nikdo neviděl', () => {
    render(<SystemBar states={[trial, backup]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'backupExpiring');
  });

  it('bez stavů se nevykreslí nic', () => {
    const { container } = render(<SystemBar states={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
