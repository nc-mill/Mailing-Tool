import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderIntl } from '../../../test/helpers/intl';
import { FormatGuide } from './format-guide';
import { sampleCsv, sampleCsvHref } from './sample-csv';

/**
 * Nápověda k formátu souboru je odpověď na stížnost „nikde není vysvětleno, jak
 * má CSV vypadat". Tlačítko, které ji otevírá, bylo do 5. 8. 2026 mrtvé: volalo
 * nepovinnou propu `onGuide`, kterou mu nikdo nepředal. Testy proto hlídají
 * OBOJÍ: že se panel doopravdy otevře a že v něm je vzor ke stažení.
 */
describe('nápověda k formátu souboru', () => {
  it('se rozbalí a vypíše povinný sloupec i limity', async () => {
    renderIntl(<FormatGuide />);

    await userEvent.click(screen.getByRole('button', { name: /jak má vypadat soubor/i }));

    expect(screen.getByText(/E-mail \(povinný\)/)).toBeInTheDocument();
    expect(screen.getByText(/Nejvýš 200 sloupců/)).toBeInTheDocument();
    // Co neumíme, se v nápovědě říká rovnou. Sešit .xlsx přečíst neumíme.
    expect(screen.getByText(/Sešity \.xlsx/)).toBeInTheDocument();
  });

  it('nabízí vzorové CSV ke stažení, ne jen popis', async () => {
    renderIntl(<FormatGuide />);
    await userEvent.click(screen.getByRole('button', { name: /jak má vypadat soubor/i }));

    const link = screen.getByRole('link', { name: /stáhnout vzorové csv/i });
    expect(link).toHaveAttribute('download', 'vzor-kontakty.csv');
    expect(link.getAttribute('href')).toMatch(/^data:text\/csv;charset=utf-8,/);
  });
});

/**
 * Vzor musí projít vlastním importem bez jediné ruční změny, jinak je to past.
 * Hlídají se dvě věci, na kterých to stálo:
 *   - hlavička v BOM, protože bez něj otevře český Excel UTF-8 jako Windows-1250,
 *   - názvy sloupců ve slovníku hlaviček, aby se mapování nastavilo samo.
 */
describe('vzorové CSV', () => {
  it('začíná BOM a nese hlavičku, kterou umíme rozpoznat', () => {
    const sample = sampleCsv('cs');
    const href = sampleCsvHref(sample);
    const decoded = decodeURIComponent(href.slice('data:text/csv;charset=utf-8,'.length));

    expect(decoded.startsWith('\uFEFF')).toBe(true);
    expect(decoded.split('\n')[0]).toBe('\uFEFFE-mail,Jméno,Příjmení,Titul,Pohlaví,Jazyk');
    // Tři ukázkové řádky a prázdný konec řádku na konci souboru.
    expect(decoded.trimEnd().split('\n')).toHaveLength(4);
  });

  it('má pro anglické rozhraní anglické názvy sloupců', () => {
    expect(sampleCsv('en').content.split('\n')[0]).toBe(
      'Email,First name,Last name,Title,Gender,Language',
    );
  });
});
