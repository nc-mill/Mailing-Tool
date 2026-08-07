import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavDrawer } from './nav-drawer';

function open(overrides: { onOpenChange?: (open: boolean) => void } = {}) {
  return render(
    <NavDrawer
      open
      onOpenChange={overrides.onOpenChange ?? (() => {})}
      title="Hlavní navigace"
      closeLabel="Zavřít hlavní menu"
    >
      <a href="/w/eshop-kolo/contacts">Kontakty</a>
    </NavDrawer>,
  );
}

describe('NavDrawer', () => {
  it('zavřený panel nevykreslí ani obsah menu', () => {
    render(
      <NavDrawer open={false} onOpenChange={() => {}} title="Hlavní navigace" closeLabel="Zavřít">
        <a href="/w/eshop-kolo/contacts">Kontakty</a>
      </NavDrawer>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Kontakty' })).toBeNull();
  });

  it('otevřený panel je modální a nese obsah menu', () => {
    open();

    const panel = screen.getByRole('dialog');
    expect(panel).toBeInTheDocument();
    // Nadpis je VIDĚT, ne jen pro čtečku: panel bez nadpisu vypadá jako
    // useknutá stránka a Radix by navíc hlásil dialog bez přístupného jména.
    expect(screen.getByText('Hlavní navigace')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Kontakty' })).toBeInTheDocument();
  });

  it('křížek zavírá', async () => {
    const onOpenChange = vi.fn();
    open({ onOpenChange });

    await userEvent.click(screen.getByRole('button', { name: 'Zavřít hlavní menu' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape zavírá, protože na úzkém displeji panel překrývá celou stránku', async () => {
    const onOpenChange = vi.fn();
    open({ onOpenChange });

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('zavírací tlačítko drží nejmenší klikací cíl, ne velikost ikony', () => {
    open();

    // Rozměr se v jsdom nezměří, hlídá se tedy třída s tokenem. Kdyby ji někdo
    // vyměnil za `size-8`, cíl spadne na 32 px a na dotykovém displeji se do
    // něj přestane trefovat (WCAG 2.2, kritérium 2.5.8).
    expect(screen.getByRole('button', { name: 'Zavřít hlavní menu' }).className).toContain(
      'size-[var(--size-target-min)]',
    );
  });
});
