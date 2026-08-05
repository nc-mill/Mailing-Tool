import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';

/**
 * Vada z živé instalace: uživatel měl v profilu uloženou angličtinu a přesto
 * viděl všechno česky. Jazyk se ukládal do `users.locale`, jenže rozhraní řídí
 * cookie `NEXT_LOCALE` a prefix v adrese, a ani jedno se po uložení neměnilo.
 *
 * Testy proto hlídají obojí naráz: zápis cookie a přesměrování na tutéž
 * obrazovku ve zvolené jazykové variantě.
 */

const mutate = vi.fn();
const cookieSet = vi.fn();
const cookieGet = vi.fn(() => undefined as { value: string } | undefined);
const redirectToLocale = vi.fn();
const revalidatePath = vi.fn();

/** Jazyk, kterým rozhraní mluví v okamžiku uložení. Testy si ho přepínají. */
let uiLocale: 'cs' | 'en' = 'cs';

vi.mock('@/lib/api-client/mutate', () => ({
  apiMutate: (...args: unknown[]) => mutate(...args),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, get: cookieGet }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => uiLocale,
}));

vi.mock('@mlain/i18n/navigation', () => ({
  redirect: (...args: unknown[]) => {
    redirectToLocale(...args);
    throw new Error('NEXT_REDIRECT');
  },
}));

const { updateProfileAction } = await import('./actions');

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const VALID = { name: 'Petr Novák', locale: 'en', timezone: 'Europe/Prague' };

function saved(locale: string): void {
  mutate.mockResolvedValue({ ok: true, data: { user: { id: 'u1', locale } } });
}

function asSuccess(state: ActionState): { channel: string; messageKey: string } {
  if (state.status !== 'success') throw new Error(`Čekal jsem úspěch, přišlo ${state.status}`);
  return state;
}

beforeEach(() => {
  uiLocale = 'cs';
  mutate.mockReset();
  cookieSet.mockReset();
  cookieGet.mockReset();
  redirectToLocale.mockReset();
  revalidatePath.mockReset();
});

describe('updateProfileAction', () => {
  it('po uložení jiného jazyka nastaví cookie a přesměruje na jeho variantu', async () => {
    saved('en');

    await expect(updateProfileAction(IDLE, form(VALID))).rejects.toThrow('NEXT_REDIRECT');

    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'en',
      expect.objectContaining({ path: '/' }),
    );
    expect(redirectToLocale).toHaveBeenCalledWith({ href: '/settings/profile', locale: 'en' });
  });

  it('přepnutí zpátky do češtiny míří na českou variantu, ne na anglickou adresu', async () => {
    uiLocale = 'en';
    saved('cs');

    await expect(updateProfileAction(IDLE, form({ ...VALID, locale: 'cs' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'cs',
      expect.objectContaining({ path: '/' }),
    );
    expect(redirectToLocale).toHaveBeenCalledWith({ href: '/settings/profile', locale: 'cs' });
  });

  it('beze změny jazyka nepřesměrovává a nechá inline hlášku Uloženo', async () => {
    saved('cs');

    const state = asSuccess(await updateProfileAction(IDLE, form({ ...VALID, locale: 'cs' })));

    expect(redirectToLocale).not.toHaveBeenCalled();
    expect(state.channel).toBe('inline');
    expect(state.messageKey).toBe('profile.identity.saved');
    // Cookie se zapíše i tak: relace může být starší než tenhle mechanismus
    // a bez cookie by rozhraní řídila hlavička prohlížeče.
    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'cs',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('když odpověď uživatele nenese, platí hodnota z formuláře', async () => {
    mutate.mockResolvedValue({ ok: true, data: undefined });

    await expect(updateProfileAction(IDLE, form(VALID))).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectToLocale).toHaveBeenCalledWith({ href: '/settings/profile', locale: 'en' });
  });

  it('neznámý jazyk spadne na výchozí, ne na chybu', async () => {
    uiLocale = 'en';
    saved('de');

    await expect(updateProfileAction(IDLE, form({ ...VALID, locale: 'de' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(redirectToLocale).toHaveBeenCalledWith({ href: '/settings/profile', locale: 'cs' });
  });

  it('při chybě serveru nemění ani cookie, ani adresu', async () => {
    mutate.mockResolvedValue({
      ok: false,
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/me',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'locale', code: 'validation_failed', message: 'Nepodporovaný jazyk.' }],
      },
    });

    const state = await updateProfileAction(IDLE, form(VALID));

    expect(state.status).toBe('error');
    expect(cookieSet).not.toHaveBeenCalled();
    expect(redirectToLocale).not.toHaveBeenCalled();
  });
});
