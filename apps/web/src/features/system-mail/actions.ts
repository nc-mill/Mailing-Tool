'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { AUTO_PROVIDER } from './types';

function validationProblem(
  issues: Array<{ path: string; code: string; message: string }>,
): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance: '/api/v1/system-mail/settings',
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

const SaveSchema = z.object({
  workspace_id: z.string().min(1),
  slug: z.string().min(1),
  /** Prázdný řetězec znamená „vyber automaticky", ne chybějící hodnotu. */
  provider_id: z.string(),
  from_address: z.string().trim(),
});

/**
 * Uloží, kterým účtem systémová pošta chodí a z jaké adresy.
 *
 * Obě pole umí být prázdná a prázdno má význam: „rozhodni za mě". Posílá se
 * proto `null`, ne vynechané pole, a metodou PUT: formulář nese celý stav
 * obrazovky, takže smazání adresy se musí projevit jako smazání.
 */
export async function saveSystemMailSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SaveSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    slug: formData.get('slug'),
    provider_id: formData.get('provider_id') ?? '',
    from_address: formData.get('from_address') ?? '',
  });

  if (!parsed.success) {
    return failed(
      'inlineBlock',
      validationProblem([
        { path: 'from_address', code: 'invalid', message: 'Formulář se nepodařilo přečíst.' },
      ]),
    );
  }

  const result = await apiMutate<unknown>('/api/v1/system-mail/settings', {
    method: 'PUT',
    body: {
      // `auto` je hodnota položky „vybrat automaticky". Radix nedovolí prázdný
      // řetězec jako hodnotu položky, takže sentinel musí být pojmenovaný.
      provider_id:
        parsed.data.provider_id === '' || parsed.data.provider_id === AUTO_PROVIDER
          ? null
          : parsed.data.provider_id,
      from_address: parsed.data.from_address === '' ? null : parsed.data.from_address,
    },
    workspaceId: parsed.data.workspace_id,
  });
  if (!result.ok) {
    return failed('inlineBlock', result.problem, { from_address: parsed.data.from_address });
  }

  revalidatePath(`/w/${parsed.data.slug}/settings/system-mail`);
  revalidatePath(`/w/${parsed.data.slug}/settings/members`);
  return succeeded({ channel: 'inlineBlock', messageKey: 'systemMail.form.done' });
}
