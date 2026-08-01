'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-key';

/** Sekret se vrací právě jednou, při vytvoření a při rotaci (3.5 části 1). */
export type SecretResult = { id: string; secret: string };

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

const CreateSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  scopes: z.array(z.string().min(1)).min(1),
});

export async function createApiKeyAction(
  _previous: ActionState<SecretResult>,
  formData: FormData,
): Promise<ActionState<SecretResult>> {
  const parsed = CreateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    name: formData.get('name'),
    scopes: formData.getAll('scopes').map(String),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/api-keys',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') === 'scopes' ? 'scopes' : issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<SecretResult>('/api/v1/api-keys', {
    method: 'POST',
    body: { name: parsed.data.name, scopes: parsed.data.scopes },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'apiKeys.secret.title',
    data: result.data,
  });
}

const RotateSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  key_id: z.string().min(1),
  grace_seconds: z.coerce.number().int().min(0).max(86400),
});

export async function rotateApiKeyAction(
  _previous: ActionState<SecretResult>,
  formData: FormData,
): Promise<ActionState<SecretResult>> {
  const parsed = RotateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    key_id: formData.get('key_id'),
    grace_seconds: formData.get('grace_seconds') ?? 0,
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/api-keys', [
        { path: 'grace_seconds', code: 'out_of_range', message: 'Zvolte 0 až 86400 sekund.' },
      ]),
    );
  }

  const result = await apiMutate<SecretResult>(`/api/v1/api-keys/${parsed.data.key_id}/rotate`, {
    method: 'POST',
    body: { grace_seconds: parsed.data.grace_seconds },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({ channel: 'page', messageKey: 'apiKeys.rotate.done', data: result.data });
}

const RevokeSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  key_id: z.string().min(1),
  name: z.string().min(1),
});

export async function revokeApiKeyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RevokeSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    key_id: formData.get('key_id'),
    name: formData.get('name'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/api-keys', [
        { path: 'key_id', code: 'required', message: 'Chybí klíč.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/api-keys/${parsed.data.key_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/api-keys`);
  return succeeded({
    channel: 'page',
    messageKey: 'apiKeys.revoke.done',
    values: { name: parsed.data.name },
  });
}
