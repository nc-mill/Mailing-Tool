import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/helpers/intl';
import { ImportResult, resultStatusOf, type ImportResultRow } from './import-result';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const IMPORT_ID = '9855e936-c11a-4b3d-b799-33a53178916c';
const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

function row(overrides: Partial<ImportResultRow> = {}): ImportResultRow {
  return {
    id: IMPORT_ID,
    status: 'completed',
    totalRows: 3,
    createdRows: 3,
    updatedRows: 0,
    suppressedRows: 0,
    errorRows: 0,
    checkpointRow: 3,
    reviewRows: 0,
    errorSummary: {},
    failureDetail: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'EventSource',
    class {
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Stav importu na stav obrazovky. Vada byla přesně v tomhle převodu: cokoli mimo čtyř
 * koncových stavů se překlopilo na `failed`, takže běžící import obrazovka označila
 * za selhaný a k tomu tvrdila, že se nezapsal žádný kontakt.
 */
describe('resultStatusOf', () => {
  it('NEPOVAŽUJE běžící import za selhaný', () => {
    for (const raw of ['pending', 'validating', 'previewing', 'importing']) {
      expect(resultStatusOf(raw)).toBe('running');
    }
  });

  it('keeps the four terminal statuses as they are', () => {
    for (const raw of ['completed', 'completed_with_errors', 'cancelled', 'failed']) {
      expect(resultStatusOf(raw)).toBe(raw);
    }
  });

  it('reports a status it does not know as unknown, not as failure', () => {
    expect(resultStatusOf('quarantined')).toBe('unknown');
  });
});

describe('import result screen', () => {
  it('shows the progress for a running import, not a failure', () => {
    renderIntl(
      <ImportResult
        row={row({ status: 'running', createdRows: 0 })}
        workspaceSlug="projekt"
        workspaceId={WORKSPACE_ID}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/ještě běží/i);
    // Ani slovo o selhání, dokud import běží.
    expect(screen.queryByText(/nepodařilo dokončit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nezapsal žádný kontakt/i)).not.toBeInTheDocument();
    // Místo toho průběh, tentýž jako v posledním kroku průvodce.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('offers a refresh instead of a verdict when the status is unknown', () => {
    renderIntl(
      <ImportResult
        row={row({ status: 'unknown', rawStatus: 'quarantined' })}
        workspaceSlug="projekt"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/quarantined/);
    expect(screen.queryByText(/nezapsal žádný kontakt/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /obnovit/i })).toBeInTheDocument();
  });

  it('still says plainly that nothing was written when the import really failed', () => {
    renderIntl(
      <ImportResult
        row={row({ status: 'failed', createdRows: 0, failureDetail: 'storage_unavailable' })}
        workspaceSlug="projekt"
      />,
    );

    expect(screen.getByText(/nezapsal žádný kontakt/i)).toBeInTheDocument();
  });
});
