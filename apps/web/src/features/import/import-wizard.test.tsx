import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportOptionsSchema } from '@mlain/core/contacts/import';
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

const LIST_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a384';
const TAG_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a385';

function renderWizard(
  step: 'fileCheck' | 'mapping' | 'options' = 'fileCheck',
  lists: { id: string; name: string; optIn: 'single' | 'double' }[] = [],
) {
  window.history.replaceState({}, '', `/?step=${step}`);
  return renderIntl(
    <ImportWizard
      workspaceId={WORKSPACE_ID}
      workspaceSlug="preflight-projekt"
      importId={IMPORT_ID}
      initialStep={step}
      lists={lists}
    />,
  );
}

type Call = { url: string; init?: RequestInit };

/**
 * Odpovědi serveru na všechno, co krok Volby volá: založení štítku, uložení voleb
 * a potvrzení importu.
 */
function stubOptionsFetch(calls: Call[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.startsWith('/api/v1/tags') && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { id: TAG_ID, name: 'import-2026-08-01' } }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify(apiPreview()), { status: 200 });
    }),
  );
}

async function submitOptions(calls: Call[]): Promise<Record<string, unknown>> {
  await userEvent.click(await screen.findByRole('button', { name: /naimportovat/i }));
  await waitFor(() => expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(true));
  const patch = calls.find((call) => call.init?.method === 'PATCH');
  const body = JSON.parse(String(patch?.init?.body)) as { options: Record<string, unknown> };
  return body.options;
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

/**
 * Krok Volby proti SKUTEČNÉMU schématu serveru, ne proti vymyšlenému tvaru.
 *
 * `ImportOptionsSchema` je tentýž objekt, kterým požadavek prochází v `patchImport()`,
 * a je `.strict()`. Test tedy chytí obojí: klíč, který schéma nezná (posílalo se `tag`,
 * schéma zná `tag_ids`), i hodnotu mimo výčet (`on_conflict: 'error'`). Tvrzení proti
 * ručně opsanému tvaru odpovědi by tuhle třídu chyb minulo, protože ta chyba je právě
 * v tom, že se opsaný tvar rozešel se schématem.
 */
describe('import wizard options step', () => {
  // Po odeslání voleb jde průvodce na krok Průběh, který otevírá SSE. jsdom EventSource
  // nemá, takže bez téhle náhrady spadne test na výjimce z komponenty, která s volbami
  // nesouvisí.
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

  it('sends options the server schema accepts, including the list and the declaration', async () => {
    const calls: Call[] = [];
    stubOptionsFetch(calls);
    renderWizard('options', [{ id: LIST_ID, name: 'Novinky', optIn: 'double' }]);

    await userEvent.selectOptions(await screen.findByLabelText(/zařadit do seznamu/i), LIST_ID);
    await userEvent.click(screen.getByLabelText(/potvrzené/i));
    await userEvent.click(screen.getByLabelText(/potvrzuji, že tito lidé/i));

    const options = await submitOptions(calls);

    // Tohle je celý test: projde to schématem serveru, nebo ne?
    expect(() => ImportOptionsSchema.parse(options)).not.toThrow();
    expect(options).toMatchObject({
      list_ids: [LIST_ID],
      subscription_status: 'confirmed',
      tag_ids: [TAG_ID],
      consent: { purpose: 'email_marketing', declaration: true },
    });
    // Jméno štítku ve volbách být nesmí: schéma zná jen identifikátory.
    expect(options).not.toHaveProperty('tag');
  });

  it('puts the duplicate choice into duplicate_in_file, not into on_conflict', async () => {
    const calls: Call[] = [];
    stubOptionsFetch(calls);
    renderWizard('options');

    await userEvent.click(await screen.findByLabelText(/nahlásit jako chybu/i));
    const options = await submitOptions(calls);

    expect(() => ImportOptionsSchema.parse(options)).not.toThrow();
    expect(options).toMatchObject({ duplicate_in_file: 'error' });
    expect(options['on_conflict']).not.toBe('error');
  });

  it('creates the tag first, so tag_ids carries an identifier and not the typed name', async () => {
    const calls: Call[] = [];
    stubOptionsFetch(calls);
    renderWizard('options');

    const tag = await screen.findByLabelText(/přidat štítek/i);
    await userEvent.clear(tag);
    await userEvent.type(tag, 'veletrh Brno');
    const options = await submitOptions(calls);

    const created = calls.find(
      (call) => call.url.startsWith('/api/v1/tags') && call.init?.method === 'POST',
    );
    expect(JSON.parse(String(created?.init?.body))).toEqual({ name: 'veletrh Brno' });
    expect(options['tag_ids']).toEqual([TAG_ID]);
  });

  it('stops on the options step when the tag cannot be created, instead of importing quietly', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, ...(init === undefined ? {} : { init }) });
        if (url.startsWith('/api/v1/tags')) {
          return new Response(JSON.stringify({ code: 'internal_error' }), { status: 500 });
        }
        return new Response(JSON.stringify(apiPreview()), { status: 200 });
      }),
    );
    renderWizard('options');

    await userEvent.click(await screen.findByRole('button', { name: /naimportovat/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(false);
    expect(calls.some((call) => call.url.includes('/confirm'))).toBe(false);
  });
});
