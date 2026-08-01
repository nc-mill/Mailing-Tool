import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './timeline';
import type { TimelineEvent } from './types';

const events: TimelineEvent[] = [
  {
    id: 'e1',
    type: 'email_open',
    occurredAt: new Date('2026-07-31T12:41:00.000Z'),
    payload: { campaign: 'Letní výprodej' },
  },
  ...[0, 1, 2, 3].map((index) => ({
    id: `p${index}`,
    type: 'page_view',
    occurredAt: new Date(`2026-07-30T16:2${index}:00.000Z`),
    payload: {},
  })),
];

const labels = {
  today: 'Dnes',
  yesterday: 'Včera',
  loadOlder: 'Načíst starší',
  expandCluster: (count: number) => `Rozbalit ${count} událostí`,
  collapseCluster: 'Sbalit skupinu událostí',
  expanded: 'Rozbaleno',
  collapsed: 'Sbaleno',
};

/**
 * Věta se skládá v katalogu, ne v komponentě. Tady je testovací obsluha,
 * která napodobuje ICU `select` nad **celou** větou.
 */
function renderSentence({
  event,
  gender,
}: {
  event: TimelineEvent;
  gender: 'female' | 'male' | 'other';
}) {
  if (event.type === 'email_open') {
    const campaign = String(event.payload.campaign);
    if (gender === 'female') return `Otevřela kampaň ${campaign}`;
    if (gender === 'male') return `Otevřel kampaň ${campaign}`;
    return `Otevření kampaně ${campaign}`;
  }
  return 'Zobrazení stránky';
}

function base(overrides: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  return {
    events,
    gender: 'female' as const,
    timeZone: 'Europe/Prague',
    now: new Date('2026-07-31T14:00:00.000Z'),
    labels,
    renderSentence,
    formatTime: (value: Date) =>
      new Intl.DateTimeFormat('cs', {
        timeZone: 'Europe/Prague',
        hour: '2-digit',
        minute: '2-digit',
      }).format(value),
    formatDate: (value: Date) =>
      new Intl.DateTimeFormat('cs', { timeZone: 'Europe/Prague', dateStyle: 'long' }).format(value),
    hasMore: true,
    onLoadOlder: vi.fn(),
    ...overrides,
  };
}

describe('Timeline', () => {
  it('u ženy použije ženský tvar slovesa', () => {
    render(<Timeline {...base()} />);
    expect(screen.getByText('Otevřela kampaň Letní výprodej')).toBeVisible();
  });

  it('u muže mužský tvar', () => {
    render(<Timeline {...base({ gender: 'male' })} />);
    expect(screen.getByText('Otevřel kampaň Letní výprodej')).toBeVisible();
  });

  it('u neznámého rodu podstatné jméno, nikdy mužský tvar', () => {
    render(<Timeline {...base({ gender: 'other' })} />);
    expect(screen.getByText('Otevření kampaně Letní výprodej')).toBeVisible();
    expect(screen.queryByText(/Otevřel kampaň/)).toBeNull();
  });

  it('oddělovače dnů jsou mezinadpisy, ne položky seznamu', () => {
    render(<Timeline {...base()} />);
    expect(screen.getByRole('heading', { name: 'Dnes' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Včera' })).toBeVisible();
  });

  it('série stejného typu je jeden rozbalitelný řádek s počtem', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);

    const toggle = screen.getByRole('button', { name: 'Rozbalit 4 událostí' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Sbalit skupinu událostí' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('rozbalení shluku je ohlášené čtečce', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);
    await user.click(screen.getByRole('button', { name: 'Rozbalit 4 událostí' }));
    expect(screen.getByRole('status')).toHaveTextContent('Rozbaleno');
  });

  it('každá položka má trvalou kotvu v URL', () => {
    render(<Timeline {...base()} />);
    const item = screen.getByTestId('timeline-item-e1');
    expect(item).toHaveAttribute('id', 'event-e1');
    expect(within(item).getByRole('link')).toHaveAttribute('href', '#event-e1');
  });

  it('celá osa je průchozí z klávesnice', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('nabízí načtení starší dávky, dokud je co načítat', async () => {
    const user = userEvent.setup();
    const onLoadOlder = vi.fn();
    render(<Timeline {...base({ onLoadOlder })} />);
    await user.click(screen.getByRole('button', { name: 'Načíst starší' }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('bez dalších dávek tlačítko nenabízí', () => {
    render(<Timeline {...base({ hasMore: false })} />);
    expect(screen.queryByRole('button', { name: 'Načíst starší' })).toBeNull();
  });
});
