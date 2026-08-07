'use server';

import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { redirect } from '@mlain/i18n/navigation';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-key';
// Zápis jazyka do cookie má celá aplikace na jednom místě, ať nevzniknou dva
// různé způsoby. Proč se jazyk musí ukládat do cookie, je popsané tam.
import { currentLocale, localeOf, rememberLocale } from '@/lib/i18n/locale-cookie';

type Issue = { path: string; code: string; message: string };

/**
 * Kód chyby pole -> klíč do katalogu `auth`.
 *
 * Bez tohohle mezikroku se do rozhraní dostal text ze zodu („String must
 * contain at least 12 character(s)"), tedy angličtina v českém rozhraní.
 * Kódy vlevo mají dva zdroje a oba sem musí:
 *  - vlastní kontrola ve formuláři: kód je zapsaný jako zpráva u zodového
 *    pravidla níž, takže `issue.message` JE kód, ne text pro uživatele,
 *  - server: `assertPasswordPolicy` v `packages/core/src/identity/password.ts`
 *    vrací `password_too_short`, `password_too_long`, `password_too_common`
 *    a `password_contains_email`.
 */
const FIELD_MESSAGE_KEYS: Record<string, string> = {
  name_required: 'fieldErrors.nameRequired',
  email_required: 'fieldErrors.emailRequired',
  email_invalid: 'fieldErrors.emailInvalid',
  password_required: 'fieldErrors.passwordRequired',
  password_too_short: 'passwordRules.tooShort',
  password_too_long: 'passwordRules.tooLong',
  password_too_common: 'passwordRules.tooCommon',
  password_contains_email: 'passwordRules.containsEmail',
  workspace_name_required: 'fieldErrors.workspaceNameRequired',
  locale_required: 'fieldErrors.localeRequired',
  token_required: 'fieldErrors.tokenRequired',
};

/** Kódy, které si formulář vyrábí sám. Neznámý kód odsud je vada v mapě výš. */
const OWN_CODES = new Set(Object.keys(FIELD_MESSAGE_KEYS));

function validationProblem(instance: string, issues: Issue[]): Problem {
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

/**
 * Ze zodové chyby udělá seznam kódů. `issue.message` je tady KÓD, protože
 * každé pravidlo níž ho má zapsaný na místě zprávy. Text pro uživatele
 * doplní až `localize()` podle jazyka rozhraní.
 *
 * Na jedno pole se bere jen první chyba: prázdný e-mail poruší „vyplňte"
 * i „nevypadá jako e-mail" naráz a uživateli by se pod polem objevily dvě
 * věty, které říkají totéž.
 */
function issuesOf(error: z.ZodError): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join('.');
    if (seen.has(path)) continue;
    seen.add(path);
    issues.push({ path, code: issue.message, message: issue.message });
  }
  return issues;
}

/**
 * Přepíše texty chyb do jazyka rozhraní.
 *
 * `passwordLength` je délka odeslaného hesla. Hláška o krátkém heslu uživateli
 * říká, kolik znaků zadal, a bez tohohle čísla by ICU výraz spadl.
 *
 * Kód, který katalog nezná a nevyrobili jsme ho my, si nechá text ze serveru.
 * Je to poslední záchrana podle kritéria 76: radši cizí věta než prázdno.
 */
async function localize(issues: Issue[], passwordLength: number): Promise<Issue[]> {
  const t = await getTranslations('auth');
  return issues.map((issue) => {
    const key = FIELD_MESSAGE_KEYS[issue.code];
    if (key) return { ...issue, message: t(key, { count: passwordLength }) };
    if (OWN_CODES.has(issue.code) || issue.code === issue.message) {
      return { ...issue, message: t('fieldErrors.generic') };
    }
    return issue;
  });
}

/** Selhání s přeloženými hláškami a s hodnotami, které se vrátí do polí. */
async function localizedFailure(
  problem: Problem,
  values: Record<string, string>,
  passwordLength: number,
): Promise<ActionState> {
  const localized: Problem =
    problem.code === 'validation_failed' && problem.errors
      ? { ...problem, errors: await localize(problem.errors, passwordLength) }
      : problem;
  return failed('inlineBlock', localized, values);
}

/** Hodnoty z formuláře, které se po chybě vrátí do polí. Heslo mezi nimi není. */
function submitted(formData: FormData, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === 'string') values[name] = value;
  }
  return values;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

const SetupSchema = z.object({
  name: z.string().trim().min(1, 'name_required'),
  email: z.string().trim().min(1, 'email_required').email('email_invalid'),
  password: z.string().min(12, 'password_too_short').max(256, 'password_too_long'),
  workspace_name: z.string().trim().min(1, 'workspace_name_required'),
  locale: z.enum(['cs', 'en'], 'locale_required'),
});

const SETUP_KEPT_FIELDS = ['name', 'email', 'workspace_name', 'locale'] as const;

type SetupResponse = { user: { id: string; locale: string }; workspace: { slug: string } };

export async function setupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = submitted(formData, SETUP_KEPT_FIELDS);
  const password = text(formData, 'password');

  const parsed = SetupSchema.safeParse({
    name: text(formData, 'name'),
    email: text(formData, 'email'),
    password,
    workspace_name: text(formData, 'workspace_name'),
    locale: text(formData, 'locale'),
  });

  if (!parsed.success) {
    const problem = validationProblem('/api/v1/setup', issuesOf(parsed.error));
    return localizedFailure(problem, values, password.length);
  }

  const result = await apiMutate<SetupResponse>('/api/v1/setup', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: text(formData, IDEMPOTENCY_FIELD_NAME),
  });

  if (!result.ok) return localizedFailure(result.problem, values, password.length);

  // Jazyk zvolený v průvodci platí OKAMŽITĚ, ne až po dalším přihlášení:
  // cookie se nastaví ještě před přesměrováním a cíl už nese správnou
  // jazykovou variantu, takže se nikde nemihne čeština.
  const locale = localeOf(parsed.data.locale);
  await rememberLocale(locale);
  return redirect({ href: `/w/${result.data.workspace.slug}`, locale });
}

const LoginSchema = z.object({
  email: z.string().trim().min(1, 'email_required').email('email_invalid'),
  password: z.string().min(1, 'password_required'),
  next: z.string().optional(),
});

/**
 * `user` je tu VOLITELNÝ schválně, i když ho kontrakt slibuje. Přihlášení už
 * v tu chvíli proběhlo a relační cookie je nastavená; kdyby tělo odpovědi
 * z jakéhokoliv důvodu uživatele neneslo, nesmí se celá akce sesypat kvůli
 * jazyku. Chybějící hodnota spadne na výchozí jazyk instalace.
 */
type LoginResponse = {
  user?: { locale?: string };
  workspaces: Array<{ slug: string }>;
};

export async function loginAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = submitted(formData, ['email']);
  const password = text(formData, 'password');

  const nextValue = formData.get('next');
  const parsed = LoginSchema.safeParse({
    email: text(formData, 'email'),
    password,
    next: typeof nextValue === 'string' ? nextValue : undefined,
  });

  if (!parsed.success) {
    const problem = validationProblem('/api/v1/auth/login', issuesOf(parsed.error));
    return localizedFailure(problem, values, password.length);
  }

  const result = await apiMutate<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: parsed.data.email, password: parsed.data.password },
  });

  if (!result.ok) return localizedFailure(result.problem, values, password.length);

  // Jazyk se bere z účtu (`users.locale`), ne z prohlížeče. Uživatel, který
  // si zvolil angličtinu, ji má i po přihlášení z cizího počítače.
  const locale = localeOf(result.data.user?.locale ?? '');
  await rememberLocale(locale);

  const target = parsed.data.next;
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    return redirect({ href: target, locale });
  }

  const first = result.data.workspaces[0];
  return redirect({ href: first ? `/w/${first.slug}` : '/no-workspace', locale });
}

const EmailSchema = z.object({
  email: z.string().trim().min(1, 'email_required').email('email_invalid'),
});

export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = submitted(formData, ['email']);
  const parsed = EmailSchema.safeParse({ email: text(formData, 'email') });
  if (!parsed.success) {
    const problem = validationProblem('/api/v1/auth/password-reset', issuesOf(parsed.error));
    return localizedFailure(problem, values, 0);
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return localizedFailure(result.problem, values, 0);
  return succeeded({ channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
}

const ResetSchema = z.object({
  token: z.string().min(1, 'token_required'),
  new_password: z.string().min(12, 'password_too_short').max(256, 'password_too_long'),
});

export async function confirmPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const newPassword = text(formData, 'new_password');
  const parsed = ResetSchema.safeParse({
    token: text(formData, 'token'),
    new_password: newPassword,
  });
  if (!parsed.success) {
    const problem = validationProblem(
      '/api/v1/auth/password-reset/confirm',
      issuesOf(parsed.error),
    );
    return localizedFailure(problem, {}, newPassword.length);
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset/confirm', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return localizedFailure(result.problem, {}, newPassword.length);
  return succeeded({ channel: 'inlineBlock', messageKey: 'reset.doneTitle' });
}

export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = text(formData, 'token');
  const result = await apiMutate<{ workspace: { slug: string; name: string }; role: string }>(
    '/api/v1/invitations/accept',
    { method: 'POST', body: { token } },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);
  return redirect({ href: `/w/${result.data.workspace.slug}`, locale: await currentLocale() });
}

const InvitationSignupSchema = z.object({
  token: z.string().min(1, 'token_required'),
  name: z.string().trim().min(1, 'name_required'),
  password: z.string().min(12, 'password_too_short').max(256, 'password_too_long'),
});

/**
 * Založení účtu z pozvánky. E-mail se ZÁMĚRNĚ neposílá: adresu určuje pozvánka,
 * jinak by si držitel cizího tokenu založil účet na svou adresu.
 *
 * Po úspěchu se nikam nepřihlašuje znovu. Odpověď nese relační cookie, takže
 * přesměrování do projektu vede rovnou dovnitř.
 */
export async function invitationSignupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = submitted(formData, ['name']);
  const password = text(formData, 'password');
  const parsed = InvitationSignupSchema.safeParse({
    token: text(formData, 'token'),
    name: text(formData, 'name'),
    password,
  });
  if (!parsed.success) {
    const problem = validationProblem('/api/v1/invitations/signup', issuesOf(parsed.error));
    return localizedFailure(problem, values, password.length);
  }

  const result = await apiMutate<{ workspace: { slug: string } }>('/api/v1/invitations/signup', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return localizedFailure(result.problem, values, password.length);
  return redirect({ href: `/w/${result.data.workspace.slug}`, locale: await currentLocale() });
}

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'workspace_name_required'),
});

/**
 * ODCHYLKA OD PLÁNU, vynucená skutečným tvarem odpovědi P04: plán četl
 * `result.data.slug`. `POST /api/v1/workspaces` ale vrací
 * `{ workspace: { id, name, slug, ... }, role }`, ověřeno v
 * `packages/core/src/identity/api/workspaces.routes.ts`. Slug je proto
 * o úroveň hlouběji, jinak by přesměrování skončilo na `/w/undefined`.
 */
export async function createWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = submitted(formData, ['name']);
  const parsed = CreateWorkspaceSchema.safeParse({ name: text(formData, 'name') });
  if (!parsed.success) {
    const problem = validationProblem('/api/v1/workspaces', issuesOf(parsed.error));
    const localized: Problem = { ...problem, errors: await localize(problem.errors ?? [], 0) };
    return failed('page', localized, values);
  }

  const result = await apiMutate<{ workspace: { slug: string } }>('/api/v1/workspaces', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: text(formData, IDEMPOTENCY_FIELD_NAME),
  });
  if (!result.ok) return failed('page', result.problem, values);
  return redirect({ href: `/w/${result.data.workspace.slug}`, locale: await currentLocale() });
}
