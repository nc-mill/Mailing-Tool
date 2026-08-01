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
