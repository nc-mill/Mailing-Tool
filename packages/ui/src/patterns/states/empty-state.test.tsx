import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('má nadpis, vysvětlení a aspoň jednu akci', () => {
    render(
      <EmptyState
        variant="first"
        title="Zatím tu nejsou žádné kontakty"
        explanation="Kontakt je jeden člověk, kterému budete posílat e-maily. U každého si nástroj pamatuje jméno, e-mail, odkud přišel a co s vašimi e-maily dělal."
        actions={[{ label: 'Naimportovat ze souboru', onClick: () => {} }]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Zatím tu nejsou žádné kontakty' })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('vysvětlení má aspoň dvě věty', () => {
    render(
      <EmptyState
        variant="first"
        title="Segment je skupina, která se udržuje sama"
        explanation="Nastavíte podmínku a nástroj do segmentu sám přidává a odebírá lidi. Nemusíte ho ručně aktualizovat."
        actions={[{ label: 'Postavit vlastní segment', onClick: () => {} }]}
      />,
    );
    const explanation = screen.getByTestId('empty-explanation').textContent as string;
    expect(explanation.split(/[.!?]\s/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('prázdný stav po filtrování se liší a nese filtr slovy', () => {
    render(
      <EmptyState
        variant="filtered"
        title="Žádný kontakt neodpovídá"
        explanation="Zkuste filtr rozvolnit."
        filterDescription={'seznam Zákazníci, štítek Brno, stav Aktivní, hledání „novák“'}
        actions={[
          { label: 'Zrušit všechny filtry', onClick: () => {} },
          { label: 'Zrušit jen hledání', onClick: () => {} },
        ]}
      />,
    );
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'filtered');
    expect(screen.getByText(/seznam Zákazníci, štítek Brno/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zrušit všechny filtry' })).toBeVisible();
  });

  it('prázdný stav po vyprázdnění má jiný text než první', () => {
    render(
      <EmptyState
        variant="emptied"
        title="Všechny kontakty jste smazali"
        explanation="Databáze je prázdná. Můžete je naimportovat znovu, nebo obnovit ze zálohy."
        actions={[{ label: 'Naimportovat ze souboru', onClick: () => {} }]}
      />,
    );
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'emptied');
  });

  it('bez akce se nedá vykreslit, je to chyba vývojáře', () => {
    expect(() =>
      render(
        <EmptyState
          variant="first"
          title="Nic tu není"
          explanation="První věta. Druhá věta."
          actions={[]}
        />,
      ),
    ).toThrow(/aspoň jednu akci/);
  });
});
