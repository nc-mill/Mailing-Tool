import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/helpers/intl';
import { ImportWizard } from './import-wizard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const IMPORT_ID = '9855e936-c11a-4b3d-b799-33a53178916c';
const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

/** Odpověď `/preview` v přesném tvaru, ve kterém ji vrací server. */
function apiPreview(overrides: Record<string, unknown> = {}) {
  return {
    encoding: 'utf-8',
    encoding_source: 'utf8_validation',
    delimiter: ',',
    has_header: true,
    header: ['jmeno', 'email', 'prijmeni'],
    mapping: {
      '0': { target: 'first_name' },
      '1': { target: 'email' },
      '2': { target: 'last_name' },
    },
    total_rows: 50,
    total_rows_approximate: false,
    sample_rows: [
      ['Petr', 'petr@example.com', 'Novák'],
      ['Jana', 'jana@example.com', 'Nováková'],
    ],
    rows: [
      {
        row_number: 1,
        email: 'petr@example.com',
        title_prefix: null,
        first_name: 'Petr',
        last_name: 'Novák',
        gender: 'male',
        greeting: 'Dobrý den, Petře',
        state: 'ok',
      },
    ],
    mapping_warnings: [],
    ...overrides,
  };
}

function renderWizard(step: 'fileCheck' | 'mapping' = 'fileCheck') {
  window.history.replaceState({}, '', `/?step=${step}`);
  return renderIntl(
    <ImportWizard
      workspaceId={WORKSPACE_ID}
      workspaceSlug="preflight-projekt"
      importId={IMPORT_ID}
      initialStep={step}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import wizard preview loading', () => {
  it('shows the delimiter and the row count from the server, not the defaults', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(apiPreview()), { status: 200 })),
    );
    renderWizard();

    // Padesát kontaktů a padesát jedna řádků, protože hlavička je taky řádek.
    const line = await screen.findByText(/z toho 1 hlavička/i);
    expect(line.textContent).toMatch(/51/);
    expect(line.textContent).toMatch(/50/);

    // Čárka, ne výchozí středník.
    const delimiter = screen.getByLabelText(/oddělovač/i) as HTMLSelectElement;
    expect(delimiter.value).toBe(',');
  });

  it('shows the raw file cells so garbled text is visible in the sample', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(apiPreview()), { status: 200 })),
    );
    renderWizard();

    expect(await screen.findByText('Nováková')).toBeInTheDocument();
    expect(screen.getByText('jmeno')).toBeInTheDocument();
  });

  it('reports a failed preview instead of rendering default values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'internal_error' }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    );
    renderWizard();

    expect(await screen.findByRole('alert')).toHaveTextContent(/nepodařilo načíst/i);
    // Žádná výchozí čísla: krok se nesmí vykreslit vůbec.
    expect(screen.queryByText(/z toho 1 hlavička/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/oddělovač/i)).not.toBeInTheDocument();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it('sends the mapping keyed by column index, in the shape the server accepts', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, ...(init === undefined ? {} : { init }) });
        return new Response(JSON.stringify(apiPreview()), { status: 200 });
      }),
    );
    renderWizard('mapping');

    await screen.findByLabelText('email');
    await userEvent.click(screen.getByRole('button', { name: /zobrazit náhled/i }));

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      mapping: {
        '0': { target: 'first_name' },
        '1': { target: 'email' },
        '2': { target: 'last_name' },
      },
    });
  });

  it('maps columns by index, so the server suggestion survives to the mapping step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(apiPreview()), { status: 200 })),
    );
    renderWizard('mapping');

    const email = (await screen.findByLabelText('email')) as HTMLSelectElement;
    expect(email.value).toBe('email');
    const firstName = screen.getByLabelText('jmeno') as HTMLSelectElement;
    expect(firstName.value).toBe('first_name');
  });
});
