import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './workspace-switcher';

const workspaces = [
  { id: '018f2b1c-0000-7000-8000-000000000001', slug: 'eshop-kolo', name: 'E-shop Kolo' },
  { id: '018f2b1c-0000-7000-8000-000000000002', slug: 'newsletter', name: 'Newsletter' },
];

// Nultý prvek je v testu vždycky, tsconfig ale bez pojistky hlásí undefined.
const current = workspaces[0] as (typeof workspaces)[number];

describe('WorkspaceSwitcher', () => {
  it('název projektu je vždy vidět textem, ne jen barvou', () => {
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={current.id}
        onSwitch={vi.fn()}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    expect(screen.getByRole('button', { name: /E-shop Kolo/ })).toBeVisible();
  });

  it('barevný proužek je odvozený z id a je dekorativní', () => {
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={current.id}
        onSwitch={vi.fn()}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    const strip = screen.getByTestId('workspace-accent');
    expect(strip).toHaveAttribute('aria-hidden', 'true');
    expect(strip.getAttribute('style')).toContain('oklch');
  });

  it('přepnutí projektu vede na Přehled nového projektu, ne na stejnou stránku', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={current.id}
        onSwitch={onSwitch}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Newsletter' }));
    expect(onSwitch).toHaveBeenCalledWith('newsletter');
  });

  it('založení projektu stojí až ZA seznamem projektů, ne mezi nimi', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={current.id}
        onSwitch={vi.fn()}
        onCreate={onCreate}
        labels={{
          switcher: 'Přepnout projekt',
          current: (name) => `Projekt: ${name}`,
          create: 'Nový projekt',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['E-shop Kolo', 'Newsletter', 'Nový projekt']);

    await user.click(screen.getByRole('menuitem', { name: 'Nový projekt' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('bez obsluhy se položka „Nový projekt" vůbec nenabídne', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={current.id}
        onSwitch={vi.fn()}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    expect(screen.queryByRole('menuitem', { name: 'Nový projekt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});
