import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ListModule from './list-actions';

/**
 * Hromadné přidání kontaktů do seznamu.
 *
 * Testuje se CHOVÁNÍ vůči API, ne SQL: akce žádné SQL nepíše a psát nesmí, protože
 * pravidla přihlášení drží stavový automat v jádru. Nejdůležitější je proto tvar těla,
 * které se posílá: bez `skip_confirmation` a bez `declaration`.
 */

const mutate = vi.fn();
const fetchOne = vi.fn();

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch: (...args: unknown[]) => fetchOne(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const WORKSPACE = '019fbf52-d8b9-7b0d-b67e-528e8026a383';
const LIST = '019fbf52-d8b9-7b0d-b67e-528e8026a999';

function contact(email: string) {
  return { ok: true, data: { data: { email } } };
}

function bulk(...outcomes: string[]) {
  return {
    ok: true,
    data: {
      results: outcomes.map((outcome, index) => ({ index, outcome, contact_id: `c-${index}` })),
    },
  };
}

async function load(): Promise<typeof ListModule> {
  return import('./list-actions');
}

beforeEach(() => {
  fetchOne.mockReset().mockResolvedValue(contact('petr@example.com'));
  mutate.mockReset().mockResolvedValue(bulk('confirmation_sent'));
});

describe('hromadné přidání do seznamu', () => {
  it('dohledá adresy k označeným ID a pošle je hromadnému přihlášení', async () => {
    fetchOne
      .mockResolvedValueOnce(contact('a@example.com'))
      .mockResolvedValueOnce(contact('b@example.com'));
    mutate.mockResolvedValue(bulk('confirmed', 'confirmed'));
    const { addContactsToListAction } = await load();

    await addContactsToListAction({ workspaceId: WORKSPACE, listId: LIST, ids: ['c-1', 'c-2'] });

    expect(fetchOne.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/contacts/c-1',
      '/api/v1/contacts/c-2',
    ]);
    expect(mutate).toHaveBeenCalledTimes(1);
    const [path, options] = mutate.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/api/v1/lists/${LIST}/subscribe:bulk`);
    expect(options['method']).toBe('POST');
    // `workspaceId` bez výjimky: bez něj chybí `X-Workspace-Id` a RLS nevrátí ani řádek.
    expect(options['workspaceId']).toBe(WORKSPACE);
    expect(options['body']).toEqual({
      subscribers: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
  });

  it('nikdy neposílá prohlášení, kterým by se odhlášený vrátil rovnou mezi příjemce', async () => {
    // Tohle je celý smysl akce. `skip_confirmation` s `declaration` je v automatu
    // jediná zkratka do stavu confirmed bez projevu vůle příjemce.
    const { addContactsToListAction } = await load();

    await addContactsToListAction({ workspaceId: WORKSPACE, listId: LIST, ids: ['c-1'] });

    const call = mutate.mock.calls[0] as [string, { body: { subscribers: unknown[] } }];
    const body = call[1].body;
    expect(JSON.stringify(body)).not.toContain('skip_confirmation');
    expect(JSON.stringify(body)).not.toContain('declaration');
    expect(body.subscribers).toEqual([{ email: 'petr@example.com' }]);
  });

  it('rozliší nově přidané, čekající na potvrzení, už přihlášené a přeskočené', async () => {
    fetchOne.mockResolvedValue(contact('kdokoliv@example.com'));
    mutate.mockResolvedValue(
      bulk(
        'confirmed',
        'confirmation_sent',
        'resend_throttled',
        'already_confirmed',
        'blocked_complaint',
        'blocked_suppressed',
        'invalid_email',
      ),
    );
    const { addContactsToListAction } = await load();

    const result = await addContactsToListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7'],
    });

    expect(result).toEqual({
      status: 'success',
      // `resend_throttled` patří k čekajícím: řádek v seznamu vznikl, jen se
      // potvrzovací e-mail zrovna neposlal kvůli limitu.
      summary: { confirmed: 1, pending: 2, already: 1, blocked: 3 },
    });
  });

  it('prázdný výběr do API vůbec nepošle', async () => {
    const { addContactsToListAction } = await load();

    const result = await addContactsToListAction({ workspaceId: WORKSPACE, listId: LIST, ids: [] });

    expect(result).toEqual({ status: 'error', code: 'validation_failed' });
    expect(fetchOne).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('chybu při čtení adresy vrátí kódem a nic nepřihlásí', async () => {
    fetchOne.mockResolvedValue({ ok: false, problem: { code: 'not_found' } });
    const { addContactsToListAction } = await load();

    const result = await addContactsToListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1'],
    });

    expect(result).toEqual({ status: 'error', code: 'not_found' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('chybu z přihlášení vrátí kódem, netváří se úspěšně', async () => {
    mutate.mockResolvedValue({ ok: false, problem: { code: 'forbidden' } });
    const { addContactsToListAction } = await load();

    const result = await addContactsToListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1'],
    });

    expect(result).toEqual({ status: 'error', code: 'forbidden' });
  });
});

function bulkRemoved(...outcomes: string[]) {
  return {
    ok: true,
    data: {
      results: outcomes.map((outcome, index) => ({ index, outcome, contact_id: `c-${index}` })),
    },
  };
}

describe('hromadné odebrání ze seznamu', () => {
  it('dohledá adresy k označeným ID a pošle je hromadnému odhlášení', async () => {
    fetchOne
      .mockResolvedValueOnce(contact('a@example.com'))
      .mockResolvedValueOnce(contact('b@example.com'));
    mutate.mockResolvedValue(bulkRemoved('unsubscribed', 'unsubscribed'));
    const { removeContactsFromListAction } = await load();

    await removeContactsFromListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1', 'c-2'],
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const [path, options] = mutate.mock.calls[0] as [string, Record<string, unknown>];
    // Tatáž cesta jako u přidání, jen metodou DELETE: jednotlivá dvojice je taky
    // POST a DELETE nad `/subscribe`.
    expect(path).toBe(`/api/v1/lists/${LIST}/subscribe:bulk`);
    expect(options['method']).toBe('DELETE');
    expect(options['workspaceId']).toBe(WORKSPACE);
    expect(options['body']).toEqual({ emails: ['a@example.com', 'b@example.com'] });
  });

  it('rozliší opravdu odhlášené od těch, u kterých nebylo co měnit', async () => {
    mutate.mockResolvedValue(
      bulkRemoved('unsubscribed', 'unchanged', 'unknown_contact', 'unsubscribed'),
    );
    const { removeContactsFromListAction } = await load();

    const result = await removeContactsFromListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1', 'c-2', 'c-3', 'c-4'],
    });

    // `unknown_contact` patří k `unchanged`: pro uživatele je to táž věta.
    expect(result).toEqual({ status: 'success', summary: { unsubscribed: 2, unchanged: 2 } });
  });

  it('prázdný výběr do API vůbec nepošle', async () => {
    const { removeContactsFromListAction } = await load();

    const result = await removeContactsFromListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: [],
    });

    expect(result).toEqual({ status: 'error', code: 'validation_failed' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('chybu z odhlášení vrátí kódem, netváří se úspěšně', async () => {
    mutate.mockResolvedValue({ ok: false, problem: { code: 'not_found' } });
    const { removeContactsFromListAction } = await load();

    const result = await removeContactsFromListAction({
      workspaceId: WORKSPACE,
      listId: LIST,
      ids: ['c-1'],
    });

    expect(result).toEqual({ status: 'error', code: 'not_found' });
  });
});
