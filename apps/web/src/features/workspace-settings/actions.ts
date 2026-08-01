'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';

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

const GeneralSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  locale: z.string().min(2),
  timezone: z.string().min(1),
});

export async function updateWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GeneralSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/workspaces',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const { workspace_id: workspaceId, ...body } = parsed.data;
  const result = await apiMutate<{ slug: string }>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body,
    workspaceId,
  });
  if (!result.ok) return failed('inline', result.problem);

  // Slug je součástí cesty, takže po jeho změně musí uživatel skončit na nové adrese.
  if (result.data.slug !== formData.get('current_slug')) {
    redirect(`/w/${result.data.slug}/settings/general`);
  }

  revalidatePath(`/w/${result.data.slug}/settings/general`);
  return succeeded({ channel: 'inline', messageKey: 'shared.saved' });
}

const AddressFormSchema = z.object({
  workspace_id: z.string().min(1),
  address_form: z.enum(['formal', 'informal']),
});

export async function updateAddressFormAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = AddressFormSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    address_form: formData.get('address_form'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'address_form', code: 'invalid', message: 'Vyberte vykání, nebo tykání.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, address_form: addressForm } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: { address_form: addressForm },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(`/w/${String(formData.get('slug'))}/settings/general`);
  return succeeded({ channel: 'page', messageKey: 'general.addressForm.started' });
}

const DeleteSchema = z.object({
  workspace_id: z.string().min(1),
  confirm_name: z.string().min(1),
});

export async function deleteWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = DeleteSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    confirm_name: formData.get('confirm_name'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'confirm_name', code: 'required', message: 'Opište název projektu.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, confirm_name: confirmName } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'DELETE',
    body: { confirm_name: confirmName },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  redirect('/no-workspace');
}
