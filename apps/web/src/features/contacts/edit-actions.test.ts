import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeContactState } from './contact-state';
import type { ContactStatus } from './filters';

/**
 * Volba správce při ručním zadání kontaktu.
 *
 * ZADÁNÍ ZADAVATELE: „Když přidávám ručně kontakt, tak nemusí být ověřený. Je na mě
 * jako správci, jestli mám nebo nemám e-maily, které přidávám, ověřené."
 *
 * Test hlídá TĚLO POŽADAVKU, ne klikání: stav kontaktu, stav přihlášení do seznamů
 * a záznam souhlasu musí odpovídat jedné a téže volbě. Kdyby se rozešly, vznikl by
 * kontakt, který je v seznamu potvrzený, ale sám nepotvrzený, tedy dvě protichůdné
 * odpovědi na otázku „smím mu poslat e-mail?".
 */

const mutate = vi.fn();

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `redirect()` normálně vyhodí NEXT_REDIRECT a ukončí akci. V testu stačí, aby
// nic neudělal: zajímá nás tělo požadavku, které vzniklo před ním.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

type Body = {
  status?: string;
  lists?: { list_id: string; status: string }[];
  consent?: { purpose: string; status: string; legal_basis: string; evidence?: unknown }[];
  source?: string;
};

function formOf(subscription: string | null): FormData {
  const form = new FormData();
  form.set('workspace_id', 'w-1');
  form.set('workspace_slug', 'eshop');
  form.set('email', 'jana@firma.cz');
  form.append('list', 'l-1');
  if (subscription !== null) form.set('subscription', subscription);
  return form;
}

/** Tělo prvního volání POST /contacts. */
function sentBody(): Body {
  const call = mutate.mock.calls.find(([path]) => path === '/api/v1/contacts');
  expect(call, 'akce nezavolala POST /api/v1/contacts').toBeDefined();
  return (call![1] as { body: Body }).body;
}

beforeEach(() => {
  mutate.mockReset();
  mutate.mockResolvedValue({ ok: true, data: { data: { id: 'c-1' } } });
});

describe('createContactAction', () => {
  it('u přihlášeného zakládá kontakt jako active a seznam jako confirmed', async () => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf('confirmed'));

    const body = sentBody();
    expect(body.status).toBe('active');
    expect(body.lists).toEqual([{ list_id: 'l-1', status: 'confirmed' }]);
  });

  /**
   * Souhlas se zapisuje ve STEJNÉM tvaru jako u importu ze souboru (účel
   * `email_marketing`, právní důvod `consent`, prohlášení správce v evidenci),
   * ne vlastním způsobem. Tabulka souhlasů je append only, takže tenhle řádek
   * už nikdo nepřepíše ani nesmaže.
   */
  it('u přihlášeného zapíše souhlas ve stejném tvaru jako import', async () => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf('confirmed'));

    expect(sentBody().consent).toEqual([
      {
        purpose: 'email_marketing',
        status: 'granted',
        legal_basis: 'consent',
        evidence: { declaration: true },
      },
    ]);
  });

  it('u nepotvrzeného zakládá unconfirmed, seznam pending a žádný souhlas', async () => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf('pending'));

    const body = sentBody();
    expect(body.status).toBe('unconfirmed');
    expect(body.lists).toEqual([{ list_id: 'l-1', status: 'pending' }]);
    // Správce nic netvrdil, takže by řádek souhlasu dokládal projev vůle,
    // který se nestal, a smazat by ho už nešlo.
    expect(body.consent).toBeUndefined();
  });

  /** Chybějící pole znamená výchozí volbu, ne nejpřísnější variantu. */
  it('bez odeslané volby platí přihlášený', async () => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf(null));

    expect(sentBody().status).toBe('active');
  });

  /** Zdroj `manual` odlišuje ruční zadání od zápisu přes API i v historii souhlasů. */
  it('drží zdroj manual, ať je volba jakákoliv', async () => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf('pending'));

    expect(sentBody().source).toBe('manual');
  });

  /**
   * Odznak stavu nesmí říkat něco jiného, než co se uložilo. Spojení drží tenhle test:
   * stav z těla požadavku se pošle do `describeContactState`, tedy do TÉŽE funkce, ze které
   * odznak čerpá na detailu i v seznamu kontaktů.
   */
  it.each([
    ['confirmed', 'status.active', 'success'],
    ['pending', 'status.unconfirmed', 'warning'],
  ])('volba %s vede na odznak %s', async (choice, labelKey, tone) => {
    const { createContactAction } = await import('./edit-actions');
    await createContactAction({ status: 'idle' }, formOf(choice));

    const view = describeContactState({
      status: sentBody().status as ContactStatus,
      processing_restricted: false,
      snooze_until: null,
      anonymized_at: null,
      status_changed_at: '2026-08-03T10:00:00Z',
    });
    expect(view.badges[0]).toEqual({ labelKey, tone });
  });

  it('bez adresy nevolá API vůbec a vrátí chybu u pole email', async () => {
    const { createContactAction } = await import('./edit-actions');
    const form = formOf('confirmed');
    form.set('email', '   ');

    const result = await createContactAction({ status: 'idle' }, form);

    expect(mutate).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });
});
