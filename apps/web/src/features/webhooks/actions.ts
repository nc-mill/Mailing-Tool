'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { IDEMPOTENCY_FIELD_NAME } from '@/lib/feedback/idempotency-key';

/** Podpisový sekret se vrací právě jednou, při vytvoření endpointu (3.8 části 1). */
export type WebhookSecretResult = { id: string; secret: string };

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

const BaseSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
});

const EndpointSchema = BaseSchema.extend({
  url: z.string().trim().url().startsWith('https://'),
  description: z.string().trim().max(500),
  event_types: z.array(z.string().min(1)).min(1).max(50),
});

export async function createWebhookAction(
  _previous: ActionState<WebhookSecretResult>,
  formData: FormData,
): Promise<ActionState<WebhookSecretResult>> {
  const parsed = EndpointSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    url: formData.get('url'),
    description: formData.get('description') ?? '',
    event_types: formData.getAll('event_types').map(String),
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem(
        '/api/v1/webhook-endpoints',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<WebhookSecretResult>('/api/v1/webhook-endpoints', {
    method: 'POST',
    body: {
      url: parsed.data.url,
      description: parsed.data.description,
      event_types: parsed.data.event_types,
    },
    workspaceId: parsed.data.workspace_id,
    idempotencyKey: String(formData.get(IDEMPOTENCY_FIELD_NAME) ?? ''),
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({
    channel: 'inlineBlock',
    messageKey: 'webhooks.secret.title',
    data: result.data,
  });
}

const UpdateSchema = EndpointSchema.extend({ endpoint_id: z.string().min(1) });

export async function updateWebhookAction(
  _previous: ActionState<WebhookSecretResult>,
  formData: FormData,
): Promise<ActionState<WebhookSecretResult>> {
  const parsed = UpdateSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
    url: formData.get('url'),
    description: formData.get('description') ?? '',
    event_types: formData.getAll('event_types').map(String),
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/webhook-endpoints',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-endpoints/${parsed.data.endpoint_id}`, {
    method: 'PATCH',
    body: {
      url: parsed.data.url,
      description: parsed.data.description,
      event_types: parsed.data.event_types,
    },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'inline', messageKey: 'shared.saved' });
}

const EndpointIdSchema = BaseSchema.extend({ endpoint_id: z.string().min(1) });

export async function deleteWebhookAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'toast',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/webhook-endpoints/${parsed.data.endpoint_id}`, {
    method: 'DELETE',
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) return failed('toast', result.problem);

  // Příznak `emptied` rozliší stav S3 od S1, viz rozhodnutí R8.
  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'toast', messageKey: 'webhooks.delete.done' });
}

export async function testWebhookAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  /**
   * ODCHYLKA OD PLÁNU, vynucená chováním API: plán čekal odpověď
   * `{ status, duration_ms }`, tedy synchronní výsledek doručení. Endpoint
   * ale vrací `202 { event_id }`: událost se **zařadí do fronty** a výsledek
   * se objeví až v logu doručení. Naměřeno v prohlížeči, kde se vypsalo
   * „Vaše adresa odpověděla za undefined ms." Text proto říká pravdu:
   * událost je zařazená, výsledek bude v logu.
   */
  const result = await apiMutate<{ event_id: string }>(
    `/api/v1/webhook-endpoints/${parsed.data.endpoint_id}/test`,
    { method: 'POST', body: {}, workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks/${parsed.data.endpoint_id}`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.test.successTitle' });
}

export async function enableWebhookAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = EndpointIdSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-endpoints', [
        { path: 'endpoint_id', code: 'required', message: 'Chybí webhook.' },
      ]),
    );
  }

  const result = await apiMutate<void>(
    `/api/v1/webhook-endpoints/${parsed.data.endpoint_id}/enable`,
    { method: 'POST', body: {}, workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.disabled.enabled' });
}

const RetrySchema = BaseSchema.extend({
  delivery_id: z.string().min(1),
  endpoint_id: z.string().min(1),
});

export async function retryDeliveryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RetrySchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    delivery_id: formData.get('delivery_id'),
    endpoint_id: formData.get('endpoint_id'),
  });
  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/webhook-deliveries', [
        { path: 'delivery_id', code: 'required', message: 'Chybí doručení.' },
      ]),
    );
  }

  const result = await apiMutate<void>(
    `/api/v1/webhook-deliveries/${parsed.data.delivery_id}/retry`,
    { method: 'POST', body: {}, workspaceId: parsed.data.workspace_id },
  );
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(`/w/${parsed.data.slug}/settings/webhooks/${parsed.data.endpoint_id}`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'webhooks.deliveries.retried' });
}
