'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import type { Result } from '@/lib/api-client/result';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-key';

/**
 * Klíč jde do API v otevřené podobě právě jednou, při uložení. Server ho hned
 * zašifruje obálkou `enc:v1:` a zpátky vydává jen nápovědu o čtyřech znacích,
 * takže do prohlížeče se nikdy nevrátí. Do `ActionState` se proto neukládá ani
 * náhodou: stav akce se serializuje do odpovědi serverové akce.
 */
const CreateSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  provider: z.string().min(1),
  label: z.string().trim().min(1).max(60),
  api_key: z.string().trim().min(1).max(400),
  base_url: z.string().trim().optional(),
  default_model: z.string().trim().min(1).max(200),
});

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

export async function createAiCredentialAction(
  _previous: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionState<{ id: string }>> {
  const rawBaseUrl = String(formData.get('base_url') ?? '').trim();
  const parsed = CreateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    provider: formData.get('provider'),
    label: formData.get('label'),
    api_key: formData.get('api_key'),
    ...(rawBaseUrl === '' ? {} : { base_url: rawBaseUrl }),
    default_model: formData.get('default_model'),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/ai/credentials',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<{ id: string }>('/api/v1/ai/credentials', {
    method: 'POST',
    body: {
      provider: parsed.data.provider,
      label: parsed.data.label,
      api_key: parsed.data.api_key,
      ...(parsed.data.base_url === undefined ? {} : { base_url: parsed.data.base_url }),
      default_model: parsed.data.default_model,
    },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/ai`);
  return succeeded({
    channel: 'toast',
    messageKey: 'credentials.saved',
    data: { id: result.data.id },
  });
}

const TestSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  credential_id: z.string().min(1),
});

/**
 * Zkouška klíče. Provádí se seznamem modelů, ne generováním textu: ověření
 * klíče nesmí stát peníze. Odpověď providera se ven nepředává, jen kód.
 */
export async function testAiCredentialAction(
  _previous: ActionState<{ ok: boolean }>,
  formData: FormData,
): Promise<ActionState<{ ok: boolean }>> {
  const parsed = TestSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    credential_id: formData.get('credential_id'),
  });
  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem('/api/v1/ai/credentials', [
        { path: 'credential_id', code: 'invalid_value', message: 'Chybí klíč.' },
      ]),
    );
  }

  const result = await apiMutate<{ ok: boolean; error?: string }>(
    `/api/v1/ai/credentials/${parsed.data.credential_id}/test`,
    { method: 'POST', workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/ai`);
  if (!result.data.ok) {
    return failed(
      'inline',
      validationProblem('/api/v1/ai/credentials', [
        { path: 'api_key', code: result.data.error ?? 'ai_provider_unavailable', message: '' },
      ]),
    );
  }
  return succeeded({ channel: 'toast', messageKey: 'credentials.testOk', data: { ok: true } });
}

const CredentialIdSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  credential_id: z.string().min(1),
});

/**
 * Smazání klíče. Volá se přímo z klienta (`CredentialsSection`), ne přes
 * `<form>` a `useActionState`: potvrzovací dialog volá `onConfirm` jako
 * obyčejnou funkci, stejně jako `deleteContactAction` u kontaktů.
 */
export async function deleteAiCredentialAction(
  input: z.input<typeof CredentialIdSchema>,
): Promise<Result<void>> {
  const parsed = CredentialIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problem: validationProblem('/api/v1/ai/credentials', [
        { path: 'credential_id', code: 'invalid_value', message: 'Chybí klíč.' },
      ]),
    };
  }

  const result = await apiMutate<void>(`/api/v1/ai/credentials/${parsed.data.credential_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return result;

  revalidatePath(`/w/${parsed.data.slug}/settings/ai`);
  return result;
}

/** Nastavení výchozího klíče. Stejná volací konvence jako smazání. */
export async function makeDefaultAiCredentialAction(
  input: z.input<typeof CredentialIdSchema>,
): Promise<Result<void>> {
  const parsed = CredentialIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problem: validationProblem('/api/v1/ai/credentials', [
        { path: 'credential_id', code: 'invalid_value', message: 'Chybí klíč.' },
      ]),
    };
  }

  const result = await apiMutate<{ ok: boolean }>(
    `/api/v1/ai/credentials/${parsed.data.credential_id}/default`,
    { method: 'POST', workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return result;

  revalidatePath(`/w/${parsed.data.slug}/settings/ai`);
  return { ok: true, data: undefined };
}
