'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-key';

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

const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);

const ChangeRoleSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  user_id: z.string().min(1),
  role: RoleSchema,
});

export async function changeMemberRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ChangeRoleSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    user_id: formData.get('user_id'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/members', [
        { path: 'role', code: 'invalid', message: 'Neznámá role.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/members/${parsed.data.user_id}`, {
    method: 'PATCH',
    body: { role: parsed.data.role },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'toast', messageKey: 'members.changeRole.done' });
}

const RemoveSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  user_id: z.string().min(1),
});

export async function removeMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RemoveSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    user_id: formData.get('user_id'),
  });
  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/members', [
        { path: 'user_id', code: 'required', message: 'Chybí člen.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/members/${parsed.data.user_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'toast', messageKey: 'members.remove.done' });
}

const InviteSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  email: z.string().trim().email(),
  role: RoleSchema,
});

export async function inviteMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = InviteSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    email: formData.get('email'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/invitations',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<{ id: string }>('/api/v1/invitations', {
    method: 'POST',
    body: { email: parsed.data.email, role: parsed.data.role },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'members.invite.done',
    values: { email: parsed.data.email },
  });
}

/**
 * Výsledek založení člena rovnou.
 *
 * `generated_password` je vyplněné jen tehdy, když heslo vygeneroval server,
 * a projde přes stav akce do prohlížeče právě jednou. Nikam se neukládá:
 * po přechodu na jinou obrazovku ho nikdo nezjistí, ani my.
 */
export type CreatedMemberResult = {
  email: string;
  generated_password: string | null;
  password_set: boolean;
};

const CreateMemberSchema = z
  .object({
    workspace_id: z.string().min(1),
    slug: z.string().min(1),
    email: z.string().trim().email(),
    role: RoleSchema,
    password_mode: z.enum(['generated', 'manual']),
    password: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.password_mode === 'manual' && value.password.length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Heslo musí mít aspoň 12 znaků.',
      });
    }
  });

/**
 * Založí člena rovnou, bez pozvánky e-mailem.
 *
 * Existuje proto, že instalace bez systémové pošty nemá jak pozvánku doručit.
 * Heslo se buď zadá, nebo ho vygeneruje server; ve druhém případě se vrátí
 * v odpovědi, ukáže se právě jednou a nikde se neuchová.
 *
 * IDEMPOTENČNÍ KLÍČ SE NEPOSÍLÁ, na rozdíl od pozvánky. Odpověď nese heslo
 * v otevřené podobě a idempotenční mezipaměť ukládá tělo odpovědi na 24 hodin
 * do databáze. Opakované odeslání formuláře řeší samo API: druhý pokus s toutéž
 * adresou skončí na 409, ne na druhém účtu.
 */
export async function createMemberAction(
  _previous: ActionState<CreatedMemberResult>,
  formData: FormData,
): Promise<ActionState<CreatedMemberResult>> {
  const parsed = CreateMemberSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    email: formData.get('email'),
    role: formData.get('role'),
    password_mode: formData.get('password_mode') ?? 'generated',
    password: formData.get('password') ?? '',
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/members',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<{
    generated_password: string | null;
    password_set: boolean;
  }>('/api/v1/members', {
    method: 'POST',
    body: {
      email: parsed.data.email,
      role: parsed.data.role,
      // Vynechané pole znamená „vygeneruj heslo". Prázdný řetězec by neprošel
      // validací délky a hlásil by chybu tam, kde uživatel nic nevyplňoval.
      ...(parsed.data.password_mode === 'manual' ? { password: parsed.data.password } : {}),
    },
    workspaceId: parsed.data.workspace_id,
  });
  // Heslo se do `values` NEVRACÍ. Prošlo by serializované do klientského stavu
  // a zůstalo by v payloadu odpovědi akce, viz komentář v action-result.ts.
  if (!result.ok) return failed('inlineBlock', result.problem, { email: parsed.data.email });

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'members.create.done',
    values: { email: parsed.data.email },
    data: {
      email: parsed.data.email,
      generated_password: result.data.generated_password,
      password_set: result.data.password_set,
    },
  });
}

const DeleteUserSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  user_id: z.string().min(1),
  email: z.string().min(1),
});

/**
 * Smaže účet, který nepatří do žádného projektu.
 *
 * Je to jiná operace než „odebrat z projektu": ta ruší členství a účet nechává
 * být, tahle ruší účet v celé instalaci. Proto je i na jiném místě obrazovky
 * a má vlastní dialog s následky.
 */
export async function deleteUserAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = DeleteUserSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    user_id: formData.get('user_id'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/users', [
        { path: 'user_id', code: 'required', message: 'Chybí účet.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/users/${parsed.data.user_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'members.orphaned.done',
    values: { email: parsed.data.email },
  });
}

const RevokeInvitationSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  invitation_id: z.string().min(1),
  email: z.string().min(1),
});

export async function revokeInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RevokeInvitationSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    invitation_id: formData.get('invitation_id'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/invitations', [
        { path: 'invitation_id', code: 'required', message: 'Chybí pozvánka.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/invitations/${parsed.data.invitation_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({
    channel: 'toast',
    messageKey: 'members.invitations.revoked',
    values: { email: parsed.data.email },
  });
}
