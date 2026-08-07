import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportResult, type ImportResultRow } from '../../src/features/import/import-result';
import { WARNING_CODES } from '../../src/features/import/labels';
import { renderIntl } from '../helpers/intl';

/**
 * Směrovač Nextu mimo aplikaci neexistuje, takže `useRouter` v testu vyhodí
 * „invariant expected app router to be mounted" a padne CELÝ soubor, ne jedno
 * tvrzení. `ImportResult` ho začal používat ve chvíli, kdy se doplnilo
 * překreslení běžícího importu; do té doby byla komponenta bez směrovače.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const row = (patch: Partial<ImportResultRow> = {}): ImportResultRow => ({
  id: 'i1',
  status: 'completed',
  totalRows: 0,
  createdRows: 0,
  updatedRows: 0,
  suppressedRows: 0,
  errorRows: 0,
  checkpointRow: 0,
  reviewRows: 0,
  errorSummary: {},
  failureDetail: null,
  ...patch,
});

/**
 * `workspaceId` se předává, protože bez něj se tlačítko „Pokračovat od řádku"
 * NEVYKRESLÍ: volání `POST /contacts/imports/{id}/resume` se bez reference na
 * projekt poslat nedá a zašedlé tlačítko bez vysvětlení je v tomhle projektu vada.
 * Pomocník ho dřív nepředával, takže test na pokračování hledal tlačítko, které
 * z principu nemohlo vzniknout.
 */
const view = (data: ImportResultRow) =>
  renderIntl(
    <ImportResult
      row={data}
      workspaceSlug="p"
      workspaceId="019fc763-0000-7000-8000-000000000000"
      locale="cs"
    />,
  );

describe('import result', () => {
  it('uses a different heading for failed and for completed_with_errors', () => {
    const { rerender } = view(
      row({ status: 'completed_with_errors', createdRows: 12_396, totalRows: 12_461 }),
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /naimportováno 12.396 z 12.461/i,
    );
    rerender(<ImportResult row={row({ status: 'failed' })} workspaceSlug="p" locale="cs" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/nepodařilo dokončit/i);
    expect(screen.getByText(/do databáze se nezapsal žádný kontakt/i)).toBeInTheDocument();
  });

  it('breaks the result down and the numbers add up to the row count', () => {
    view(
      row({
        status: 'completed_with_errors',
        createdRows: 9812,
        updatedRows: 2584,
        suppressedRows: 9,
        errorRows: 56,
        totalRows: 12_461,
      }),
    );
    expect(screen.getByText(/^9.812$/)).toBeInTheDocument();
    expect(screen.getByText(/^2.584$/)).toBeInTheDocument();
    expect(9812 + 2584 + 9 + 56).toBe(12_461);
  });

  it('groups warnings by code and shows one line with the count', () => {
    view(row({ status: 'completed_with_errors', errorSummary: { excel_serial_date_assumed: 84 } }));
    const line = screen.getByText(/84 dat vypadalo jako číslo z excelu/i);
    expect(line).toBeInTheDocument();
    expect(
      within(line.closest('li')!).getByRole('button', { name: /zobrazit/i }),
    ).toBeInTheDocument();
  });

  it('hides a warning whose count is zero', () => {
    view(row({ status: 'completed', errorSummary: { gender_unknown: 0 } }));
    expect(screen.queryByText(/nemá určený rod/i)).toBeNull();
  });

  it('covers all eleven warning codes', () => {
    const summary = Object.fromEntries(WARNING_CODES.map((code) => [code, 3]));
    view(row({ status: 'completed_with_errors', errorSummary: summary }));
    expect(screen.getAllByRole('listitem')).toHaveLength(WARNING_CODES.length);
  });

  it('offers resuming from the cancelled row, not restarting', () => {
    view(row({ status: 'cancelled', checkpointRow: 8400, totalRows: 12_461 }));
    const button = screen.getByRole('button', { name: /pokračovat od řádku/i });
    expect(button.textContent).toMatch(/8.401/);
  });

  it('links to the review queue when contacts are waiting there', () => {
    view(row({ status: 'completed', reviewRows: 143 }));
    expect(screen.getByRole('link', { name: /zkontrolovat/i })).toHaveAttribute(
      'href',
      expect.stringContaining('vocative-review'),
    );
  });

  it('links to the contacts of this import instead of an undo action', () => {
    view(row({ status: 'completed', id: 'i9' }));
    const link = screen.getByRole('link', { name: /zobrazit naimportované kontakty/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('source_ref=i9'));
    expect(screen.queryByRole('button', { name: /vrátit tento import/i })).toBeNull();
  });
});
