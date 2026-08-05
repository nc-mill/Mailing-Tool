import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConfirmModule from './confirm-actions';

/**
 * Ruční povýšení kontaktu na potvrzený.
 *
 * Testuje se CHOVÁNÍ vůči API, ne SQL: akce žádné SQL nepíše a psát nesmí, protože
 * pravidla zápisu, audit i souhlas drží jádro. Kontroluje se proto tvar volání, které
 * jádru pošle, a to, že si žádný stav nevymýšlí sama.
 */

const mutate = vi.fn();

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const WORKSPACE = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

function ok(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    data: {
      confirm: {
        from_status: 'unconfirmed',
        changed: true,
        lists_confirmed: 1,
        suppression_removed: [],
        suppression_blocking: null,
        ...overrides,
      },
    },
  };
}

async function load(): Promise<typeof ConfirmModule> {
  return import('./confirm-actions');
}

beforeEach(() => {
  mutate.mockReset().mockResolvedValue(ok());
});

describe('povýšení kontaktu na potvrzený', () => {
  it('volá vlastní endpoint pro výslovné rozhodnutí správce, ne PATCH se stavem', async () => {
    // PATCH by u odhlášeného kontaktu odpověděl 200 a stav MLČKY nechal být
    // (pravidlo 3 ze 4.1.2 části 2), takže by rozhraní hlásilo úspěch bez změny.
    const { confirmContactsAction } = await load();

    await confirmContactsAction({ workspaceId: WORKSPACE, ids: ['c-1'] });

    expect(mutate).toHaveBeenCalledTimes(1);
    const [path, options] = mutate.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/contacts/c-1/confirm');
    expect(options['method']).toBe('POST');
    // `workspaceId` bez výjimky: bez něj chybí `X-Workspace-Id`, RLS nevrátí řádek
    // a uživatel dostane 404 na kontakt, který má otevřený.
    expect(options['workspaceId']).toBe(WORKSPACE);
  });

  it.each(['unconfirmed', 'unsubscribed', 'bounced', 'complained'])(
    'kontakt ve stavu %s povýší, místo aby ho přeskočil',
    async (status) => {
      // Přeskakování bylo to staré chování a s ním i hláška „povýšit nejde".
      // Server dnes umí povýšit z každého stavu, takže se stav ani nečte předem.
      mutate.mockResolvedValue(ok({ from_status: status }));
      const { confirmContactsAction } = await load();

      const result = await confirmContactsAction({ workspaceId: WORKSPACE, ids: ['c-1'] });

      expect(result).toEqual({
        status: 'success',
        outcomes: [
          {
            id: 'c-1',
            fromStatus: status,
            changed: true,
            listsConfirmed: 1,
            suppressionBlocking: null,
          },
        ],
      });
      expect(mutate).toHaveBeenCalledTimes(1);
    },
  );

  it('propíše zůstávající blokaci adresy, místo aby ji spolkla', async () => {
    // Nejdůležitější případ celé akce: stav se změnil, ale odesílací cesta kontakt
    // stejně přeskočí, protože suppression je v `evaluateMailability` vrstva NAD stavem.
    mutate.mockResolvedValue(ok({ from_status: 'complained', suppression_blocking: 'complaint' }));
    const { confirmContactsAction } = await load();

    const result = await confirmContactsAction({ workspaceId: WORKSPACE, ids: ['c-1'] });

    expect(result).toEqual({
      status: 'success',
      outcomes: [
        {
          id: 'c-1',
          fromStatus: 'complained',
          changed: true,
          listsConfirmed: 1,
          suppressionBlocking: 'complaint',
        },
      ],
    });
  });

  it('projde celý výběr a vrátí výsledek za každý kontakt zvlášť', async () => {
    mutate
      .mockResolvedValueOnce(ok({ from_status: 'unconfirmed' }))
      .mockResolvedValueOnce(ok({ from_status: 'unsubscribed', suppression_removed: ['manual'] }))
      .mockResolvedValueOnce(ok({ from_status: 'bounced', suppression_blocking: 'hard_bounce' }));
    const { confirmContactsAction } = await load();

    const result = await confirmContactsAction({
      workspaceId: WORKSPACE,
      ids: ['c-1', 'c-2', 'c-3'],
    });

    expect(mutate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('nedosažitelné');
    expect(result.outcomes.map((outcome) => outcome.fromStatus)).toEqual([
      'unconfirmed',
      'unsubscribed',
      'bounced',
    ]);
    expect(result.outcomes.map((outcome) => outcome.suppressionBlocking)).toEqual([
      null,
      null,
      'hard_bounce',
    ]);
  });

  it('chybu z API vrátí kódem, netváří se úspěšně', async () => {
    mutate.mockResolvedValue({ ok: false, problem: { code: 'forbidden' } });
    const { confirmContactsAction } = await load();

    const result = await confirmContactsAction({ workspaceId: WORKSPACE, ids: ['c-1'] });

    expect(result).toEqual({ status: 'error', code: 'forbidden' });
  });

  it('při chybě uprostřed výběru nepokračuje dál', async () => {
    mutate
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ ok: false, problem: { code: 'not_found' } });
    const { confirmContactsAction } = await load();

    const result = await confirmContactsAction({
      workspaceId: WORKSPACE,
      ids: ['c-1', 'c-2', 'c-3'],
    });

    expect(result).toEqual({ status: 'error', code: 'not_found' });
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
