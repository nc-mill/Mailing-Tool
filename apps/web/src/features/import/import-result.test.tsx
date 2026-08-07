import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/helpers/intl';
import { ImportResult, type ImportResultRow } from './import-result';
import { resultStatusOf } from './result-status';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

const IMPORT_ID = '9855e936-c11a-4b3d-b799-33a53178916c';
const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';
const RESUMED_ID = '019fdc40-1111-7000-8000-0000000000aa';

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
  push.mockClear();
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
  /**
   * Tlačítko „Pokračovat" tady stálo od začátku BEZ OBSLUHY: kliknutí neudělalo
   * vůbec nic, takže schopnost, kterou API umí, z rozhraní nešla použít a přitom
   * vypadala, že jde. Test proto měří ODESLANÝ POŽADAVEK, ne existenci tlačítka.
   */
  it('pokračování zrušeného importu opravdu zavolá API a odejde do průvodce', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ id: RESUMED_ID, checkpoint_byte: 120 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderIntl(
      <ImportResult
        row={row({ status: 'cancelled', checkpointRow: 1240, totalRows: 5000 })}
        workspaceSlug="projekt"
        workspaceId={WORKSPACE_ID}
      />,
    );

    const button = screen.getByRole('button', { name: /pokračovat od řádku/i });
    await userEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/contacts/imports/${IMPORT_ID}/resume`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Workspace-Id': WORKSPACE_ID }),
      }),
    );
    // Průvodce dostane NOVÝ import, ne ten zrušený: pokračování zakládá další řádek.
    expect(push).toHaveBeenCalledWith(
      `/w/projekt/contacts/import?import=${RESUMED_ID}&step=mapping`,
    );
  });

  it('neúspěšné pokračování napíše důvod, ne ticho', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })),
    );

    renderIntl(
      <ImportResult
        row={row({ status: 'cancelled', checkpointRow: 1240 })}
        workspaceSlug="projekt"
        workspaceId={WORKSPACE_ID}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /pokračovat od řádku/i }));
    expect(await screen.findByText(/pokračovat se nepodařilo/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
