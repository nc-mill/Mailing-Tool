'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { redirect as redirectToLocale } from '@mlain/i18n/navigation';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { localeOf, rememberLocale } from '@/lib/i18n/locale-cookie';

function validationProblem(
  instance: string,
  issues: Array<{ path: string; code: string; message: string }>,
): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance,
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

function issuesOf(error: z.ZodError): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

const ProfileSchema = z.object({
  name: z.string().trim().max(200),
  locale: z.string().min(2),
  timezone: z.string().min(1),
});

/** Adresa téhle obrazovky bez jazykového prefixu. Prefix doplní `redirectToLocale`. */
const PROFILE_PATH = '/settings/profile';

/** `PATCH /api/v1/auth/me` vrací uloženého uživatele, viz `auth.routes.ts`. */
type UpdateMeResponse = { user?: { locale?: string } } | undefined;

/**
 * Uložení profilu, VČETNĚ okamžitého přepnutí jazyka rozhraní.
 *
 * Proč se cookie `NEXT_LOCALE` nastavuje právě tady a nesmí to odsud zmizet:
 * volba jazyka se uloží do `users.locale`, jenže rozhraní se databází neřídí.
 * `next-intl` bere jazyk v pořadí prefix v adrese, cookie, `accept-language`,
 * výchozí jazyk (podrobně v `@/lib/i18n/locale-cookie`). Dokud se cookie
 * nezapsala tady, projevila se změna nejdřív při dalším přihlášení, protože
 * cookie psalo jen `loginAction`. Uživatel s českým prohlížečem a účtem
 * v angličtině tedy viděl dál všechno česky.
 *
 * Přesměrování řeší prefix v adrese, který je v tom pořadí PŘED cookie: kdo
 * uložil angličtinu na `/cs/settings/profile`, zůstal by i se správnou cookie
 * v češtině. Míří se proto na tutéž obrazovku ve zvolené jazykové variantě.
 *
 * ODCHYLKA OD KATALOGU AKCÍ, vynucená povahou změny: `updateProfileAction` je
 * třída A1 s kanálem `inline`, a tím zůstává, dokud se jazyk nemění. Změna
 * jazyka je ale přechod celé stránky, takže se hláška „Uloženo" nahradí
 * přeloženým rozhraním, což je zpětná vazba silnější než věta u nadpisu.
 */
export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ProfileSchema.safeParse({
    name: formData.get('name'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
  });

  if (!parsed.success) {
    return failed('inline', validationProblem('/api/v1/auth/me', issuesOf(parsed.error)));
  }

  const result = await apiMutate<UpdateMeResponse>('/api/v1/auth/me', {
    method: 'PATCH',
    body: parsed.data,
  });
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath(PROFILE_PATH);

  // Zdrojem pravdy je uložený uživatel ze serveru. Kdyby ho odpověď z jakéhokoliv
  // důvodu nenesla, platí hodnota z formuláře; neznámý jazyk spadne na výchozí.
  const saved = localeOf(result.data?.user?.locale ?? parsed.data.locale);

  // Cookie se zapisuje vždy, i když se jazyk nezměnil: uživatel mohl přijít
  // s relací starší než tenhle mechanismus a bez cookie by mu rozhraní řídil
  // prohlížeč. Tohle je to místo, kde volba účtu přebije `accept-language`.
  await rememberLocale(saved);

  // Přesměrovává se jen při skutečné změně, jinak by se zahodila hláška „Uloženo".
  if (saved !== (await getLocale())) {
    redirectToLocale({ href: PROFILE_PATH, locale: saved });
  }

  return succeeded({ channel: 'inline', messageKey: 'profile.identity.saved' });
}

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(12).max(256),
});

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ChangePasswordSchema.safeParse({
    current_password: formData.get('current_password'),
    new_password: formData.get('new_password'),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/auth/change-password', issuesOf(parsed.error)),
    );
  }

  const result = await apiMutate<void>('/api/v1/auth/change-password', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath('/settings/profile');
  return succeeded({ channel: 'inlineBlock', messageKey: 'profile.password.doneTitle' });
}

/**
 * ODCHYLKA OD PLÁNU, vynucená chybějícím poskytovatelem toastů: plán posílal
 * výsledek kanálem `toast`, jenže `ToastProvider` z P05 ve větvi `(account)`
 * nikdo nevykresluje, takže by hlášku nikdo nezobrazil a akce by zůstala bez
 * jediného kanálu zpětné vazby (kritérium 1 kapitoly 15.2 části 6). Výsledek
 * jde proto kanálem `inlineBlock` a sekce relací ho vykreslí u sebe.
 */
export async function revokeSessionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('session_id') ?? '');
  const result = await apiMutate<void>(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath('/settings/profile');
  return succeeded({ channel: 'inlineBlock', messageKey: 'profile.sessions.revoked' });
}

/**
 * Po odhlášení ze všech zařízení přestane platit i aktuální cookie, takže není
 * komu výsledek ukázat. Jediná správná zpětná vazba je přesměrování na
 * přihlášení, tedy kanál `page` z tabulky 5.2. Proto se nevrací `ActionState`.
 */
export async function logoutAllAction(): Promise<never> {
  await apiMutate<void>('/api/v1/auth/logout-all', { method: 'POST' });
  redirect('/login');
}

export async function logoutAction(): Promise<never> {
  await apiMutate<void>('/api/v1/auth/logout', { method: 'POST' });
  redirect('/login');
}
