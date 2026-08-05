import { beforeEach, describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import enAuth from '../../../../../packages/i18n/messages/en/auth.json';
import { IDLE, type ActionFailure, type ActionState } from '@/lib/feedback/action-result';

/**
 * Akce se testují s podvrženým klientem API, katalogem a navigací. Cílem jsou
 * tři věci, které rozhodly o vadách z čisté instalace:
 *  - hlášky validace jsou v jazyce rozhraní, ne v angličtině ze zodu,
 *  - po chybě se vracejí odeslané hodnoty (heslo NE),
 *  - po založení účtu se uloží jazyk uživatele a přesměruje se na jeho variantu.
 */

const mutate = vi.fn();
const cookieSet = vi.fn();
const cookieGet = vi.fn(() => undefined as { value: string } | undefined);
const redirect = vi.fn();

/** Jazyk, který právě „vidí" `getTranslations`. Testy si ho přepínají. */
let uiLocale: 'cs' | 'en' = 'cs';

vi.mock('@/lib/api-client/mutate', () => ({
  apiMutate: (...args: unknown[]) => mutate(...args),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, get: cookieGet }),
}));

vi.mock('@mlain/i18n/navigation', () => ({
  redirect: (...args: unknown[]) => {
    redirect(...args);
    throw new Error('NEXT_REDIRECT');
  },
}));

/**
 * Náhrada za `getTranslations`. Uvnitř běží SKUTEČNÝ překladač next-intl nad
 * skutečnými katalogy, takže test spadne, jakmile klíč v `auth.json` chybí
 * nebo se přejmenuje, a plurály se počítají doopravdy.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== 'auth') throw new Error(`Neočekávaný jmenný prostor ${namespace}`);
    const { createTranslator } = await import('next-intl');
    return createTranslator({
      locale: uiLocale,
      messages: { auth: uiLocale === 'cs' ? csAuth : enAuth },
      namespace: 'auth',
    });
  },
}));

const { setupAction, loginAction } = await import('./actions');

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function asFailure(state: ActionState): ActionFailure {
  if (state.status !== 'error') throw new Error(`Čekal jsem chybu, přišlo ${state.status}`);
  return state;
}

const VALID_SETUP = {
  name: 'Petr Novák',
  email: 'petr@example.com',
  password: 'dlouhe-a-bezpecne-heslo',
  workspace_name: 'Eshop',
  locale: 'en',
};

beforeEach(() => {
  uiLocale = 'cs';
  mutate.mockReset();
  cookieSet.mockReset();
  cookieGet.mockReset();
  redirect.mockReset();
});

describe('setupAction', () => {
  it('u krátkého hesla vrátí českou hlášku, ne text ze zodu', async () => {
    const state = asFailure(
      await setupAction(IDLE, form({ ...VALID_SETUP, password: 'kratke', locale: 'cs' })),
    );

    expect(state.fieldErrors['password']?.[0]).toContain('Heslo musí mít aspoň 12 znaků');
    expect(state.fieldErrors['password']?.[0]).toContain('Zadali jste 6 znaků');
    expect(JSON.stringify(state.problem)).not.toContain('String must contain');
    expect(JSON.stringify(state.problem)).not.toContain('character(s)');
  });

  it('v anglickém rozhraní vrátí tutéž hlášku anglicky', async () => {
    uiLocale = 'en';
    const state = asFailure(
      await setupAction(IDLE, form({ ...VALID_SETUP, password: 'kratke', locale: 'en' })),
    );

    expect(state.fieldErrors['password']?.[0]).toContain('needs at least 12 characters');
  });

  it('u chybného e-mailu a prázdných polí vrátí české hlášky', async () => {
    const state = asFailure(
      await setupAction(
        IDLE,
        form({ name: '', email: 'petr', password: '', workspace_name: '', locale: 'cs' }),
      ),
    );

    expect(state.fieldErrors['name']).toEqual(['Napište své jméno a příjmení.']);
    expect(state.fieldErrors['email']?.[0]).toContain('E-mail nevypadá správně');
    expect(state.fieldErrors['workspace_name']?.[0]).toContain('Pojmenujte projekt');
  });

  it('vrátí odeslané hodnoty kromě hesla', async () => {
    const state = asFailure(await setupAction(IDLE, form({ ...VALID_SETUP, password: 'kratke' })));

    expect(state.values).toEqual({
      name: 'Petr Novák',
      email: 'petr@example.com',
      workspace_name: 'Eshop',
      locale: 'en',
    });
    expect(JSON.stringify(state)).not.toContain('kratke');
  });

  it('přeloží i pravidlo hesla, které přišlo ze serveru', async () => {
    mutate.mockResolvedValue({
      ok: false,
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/setup',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [
          {
            path: 'password',
            code: 'password_too_common',
            message: 'Tohle heslo je mezi deseti tisíci nejpoužívanějšími. Zvolte jiné.',
          },
        ],
      },
    });

    const state = asFailure(await setupAction(IDLE, form(VALID_SETUP)));
    expect(state.fieldErrors['password']).toEqual([csAuth.passwordRules.tooCommon]);
  });

  it('po založení účtu uloží zvolený jazyk a přesměruje na jeho variantu', async () => {
    mutate.mockResolvedValue({
      ok: true,
      data: { user: { id: 'u1', locale: 'en' }, workspace: { slug: 'eshop' } },
    });

    await expect(setupAction(IDLE, form(VALID_SETUP))).rejects.toThrow('NEXT_REDIRECT');

    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'en',
      expect.objectContaining({ path: '/' }),
    );
    expect(redirect).toHaveBeenCalledWith({ href: '/w/eshop', locale: 'en' });
  });

  it('u české volby uloží češtinu', async () => {
    mutate.mockResolvedValue({
      ok: true,
      data: { user: { id: 'u1', locale: 'cs' }, workspace: { slug: 'eshop' } },
    });

    await expect(setupAction(IDLE, form({ ...VALID_SETUP, locale: 'cs' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'cs',
      expect.objectContaining({ path: '/' }),
    );
    expect(redirect).toHaveBeenCalledWith({ href: '/w/eshop', locale: 'cs' });
  });
});

describe('loginAction', () => {
  it('po přihlášení uloží jazyk z účtu, ne z prohlížeče', async () => {
    mutate.mockResolvedValue({
      ok: true,
      data: { user: { locale: 'en' }, workspaces: [{ slug: 'eshop' }] },
    });

    await expect(
      loginAction(IDLE, form({ email: 'petr@example.com', password: 'tajne-heslo' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(cookieSet).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'en',
      expect.objectContaining({ path: '/' }),
    );
    expect(redirect).toHaveBeenCalledWith({ href: '/w/eshop', locale: 'en' });
  });

  it('neznámý jazyk účtu spadne na výchozí, ne na chybu', async () => {
    mutate.mockResolvedValue({
      ok: true,
      data: { user: { locale: 'de' }, workspaces: [{ slug: 'eshop' }] },
    });

    await expect(
      loginAction(IDLE, form({ email: 'petr@example.com', password: 'tajne-heslo' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith({ href: '/w/eshop', locale: 'cs' });
  });

  it('cíl z pole next zachová i s jazykem uživatele', async () => {
    mutate.mockResolvedValue({
      ok: true,
      data: { user: { locale: 'en' }, workspaces: [{ slug: 'eshop' }] },
    });

    await expect(
      loginAction(
        IDLE,
        form({ email: 'petr@example.com', password: 'tajne-heslo', next: '/w/eshop/contacts' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith({ href: '/w/eshop/contacts', locale: 'en' });
  });

  it('u prázdného e-mailu vrátí českou hlášku a e-mail zpátky do pole', async () => {
    const state = asFailure(await loginAction(IDLE, form({ email: '', password: '' })));

    expect(state.fieldErrors['email']).toEqual(['Zadejte e-mail.']);
    expect(state.fieldErrors['password']).toEqual(['Zadejte heslo.']);
    expect(state.values).toEqual({ email: '' });
  });
});
