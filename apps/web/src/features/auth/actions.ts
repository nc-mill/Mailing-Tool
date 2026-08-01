'use server';

import { redirect } from 'next/navigation';
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

function issuesOf(error: z.ZodError): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

const SetupSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(12).max(256),
  workspace_name: z.string().trim().min(1),
  locale: z.enum(['cs', 'en']),
});

type SetupResponse = { user: { id: string }; workspace: { slug: string } };

export async function setupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SetupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    workspace_name: formData.get('workspace_name'),
    locale: formData.get('locale'),
  });

  if (!parsed.success) {
    return failed('inlineBlock', validationProblem('/api/v1/setup', issuesOf(parsed.error)));
  }

  const result = await apiMutate<SetupResponse>('/api/v1/setup', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });

  if (!result.ok) return failed('inlineBlock', result.problem);
  redirect(`/w/${result.data.workspace.slug}`);
}

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function loginAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return failed('inlineBlock', validationProblem('/api/v1/auth/login', issuesOf(parsed.error)));
  }

  const result = await apiMutate<{ workspaces: Array<{ slug: string }> }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: parsed.data.email, password: parsed.data.password },
  });

  if (!result.ok) return failed('inlineBlock', result.problem);

  const target = parsed.data.next;
  if (target && target.startsWith('/') && !target.startsWith('//')) redirect(target);

  const first = result.data.workspaces[0];
  redirect(first ? `/w/${first.slug}` : '/no-workspace');
}

const EmailSchema = z.object({ email: z.string().trim().email() });

export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = EmailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/auth/password-reset', [
        { path: 'email', code: 'invalid_email', message: 'Zadejte platnou e-mailovou adresu.' },
      ]),
    );
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);
  return succeeded({ channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
}

const ResetSchema = z.object({
  token: z.string().min(1),
  new_password: z.string().min(12).max(256),
});

export async function confirmPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get('token'),
    new_password: formData.get('new_password'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/auth/password-reset/confirm', issuesOf(parsed.error)),
    );
  }

  const result = await apiMutate<void>('/api/v1/auth/password-reset/confirm', {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);
  return succeeded({ channel: 'inlineBlock', messageKey: 'reset.doneTitle' });
}

export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  const result = await apiMutate<{ workspace: { slug: string; name: string }; role: string }>(
    '/api/v1/invitations/accept',
    { method: 'POST', body: { token } },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);
  redirect(`/w/${result.data.workspace.slug}`);
}

const CreateWorkspaceSchema = z.object({ name: z.string().trim().min(1) });

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
  const parsed = CreateWorkspaceSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'name', code: 'required', message: 'Zadejte název projektu.' },
      ]),
    );
  }

  const result = await apiMutate<{ workspace: { slug: string } }>('/api/v1/workspaces', {
    method: 'POST',
    body: parsed.data,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('page', result.problem);
  redirect(`/w/${result.data.workspace.slug}`);
}
