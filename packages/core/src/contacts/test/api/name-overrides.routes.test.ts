import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNameOverrideRoutes } from '../../api/name-overrides.routes';
import { apiHarness, JSON_HEADERS } from './harness';

/**
 * `POST /name-overrides` je upsert a od 7. 8. 2026 rozlišuje dvě věci, které
 * v JSON vypadají skoro stejně: **vynechané pole** („tuhle hodnotu neřeším")
 * a pole poslané jako **`null`** („vymaž ji").
 *
 * Rozdíl se dá ztratit už ve validaci těla, ne až v repozitáři: kdyby schéma
 * chybějící klíč doplnilo na `null`, dopadlo by každé vynechání jako mazání
 * a fronta kontroly oslovení by potvrzením rodu tiše smazala uložený pátý pád.
 * Tenhle test proto měří, CO PŘESNĚ dostane repozitář.
 */

const upsert = vi.fn().mockResolvedValue('0198e2c0-0000-7000-8000-00000000000a');
const remove = vi.fn().mockResolvedValue(true);
const list = vi.fn().mockResolvedValue([]);

vi.mock('../../repo/name-overrides', () => ({
  upsertNameOverride: (...args: unknown[]) => upsert(...args),
  deleteNameOverride: (...args: unknown[]) => remove(...args),
  listNameOverrides: (...args: unknown[]) => list(...args),
}));

const app = apiHarness(registerNameOverrideRoutes);

// `app.request` z Hono vrací `Response | Promise<Response>`, protože obsluha smí být
// i synchronní. `await` sjednotí obojí; holé `return` typovou kontrolu neprojde.
async function post(body: unknown): Promise<Response> {
  return await app.request('/name-overrides', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  upsert.mockClear();
  remove.mockClear();
  list.mockClear();
});

describe('POST /name-overrides: vynechané pole proti null', () => {
  it('vynechaný pátý pád dojde do repozitáře jako undefined', async () => {
    const response = await post({ kind: 'first', name: 'Nikola', gender: 'male' });
    expect(response.status).toBe(201);

    const [, input] = upsert.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.vocative).toBeUndefined();
    expect(input.note).toBeUndefined();
    expect(input.gender).toBe('male');
  });

  it('pátý pád poslaný jako null dojde do repozitáře jako null', async () => {
    const response = await post({
      kind: 'first',
      name: 'Nikola',
      gender: 'female',
      vocative: null,
    });
    expect(response.status).toBe(201);

    const [, input] = upsert.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.vocative).toBeNull();
    // Poznámka se neposlala vůbec, takže se jí zápis nesmí dotknout.
    expect(input.note).toBeUndefined();
  });

  it('chybu z repozitáře nepřebarvuje, uživatel dostane větu o rodu a pátém pádu', async () => {
    const { ApiError } = await import('../../../errors/api-error');
    upsert.mockRejectedValueOnce(
      new ApiError('validation_failed', {
        errors: [{ path: 'gender', code: 'required_field_missing', message: 'nemá co přepsat' }],
      }),
    );

    const response = await post({ kind: 'first', name: 'Nikola', vocative: null });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'validation_failed' });
  });
});
