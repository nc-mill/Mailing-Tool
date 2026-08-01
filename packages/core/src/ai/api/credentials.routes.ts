import { z } from 'zod';
import {
  encryptApiKey,
  fingerprintApiKey,
  hintFromApiKey,
  toPublicCredential,
  type CredentialRow,
} from '../credential-service';
import { mapProviderError } from '../error-map';
import { getProvider, providerIdSchema } from '../providers';

export type ApiContext = { workspaceId: string; actorId: string };

export const createCredentialBody = z.object({
  provider: providerIdSchema,
  label: z.string().min(1).max(60),
  api_key: z.string().min(1).max(400),
  base_url: z.string().url().optional(),
  default_model: z.string().min(1).max(200),
});

export type CreateCredentialDeps = {
  insertCredential: (
    row: Record<string, unknown>,
  ) => Promise<{ id: string } & Record<string, unknown>>;
  findByFingerprint: (params: {
    workspaceId: string;
    fingerprint: string;
  }) => Promise<{ id: string; label: string } | null>;
  writeAuditLog: (entry: Record<string, unknown>) => Promise<void> | void;
};

export async function handleCreateCredential(
  ctx: ApiContext,
  body: z.input<typeof createCredentialBody>,
  deps: CreateCredentialDeps,
) {
  const parsed = createCredentialBody.safeParse(body);
  if (!parsed.success) {
    return {
      status: 422 as const,
      code: 'validation_failed' as const,
      errors: parsed.error.issues,
    };
  }

  const descriptor = getProvider(parsed.data.provider);
  if (parsed.data.base_url !== undefined && !descriptor.allowsBaseUrl) {
    return {
      status: 422 as const,
      code: 'validation_failed' as const,
      errors: [{ path: 'base_url', code: 'ai_base_url_not_allowed' }],
    };
  }
  if (parsed.data.base_url === undefined && descriptor.requiresBaseUrl) {
    return {
      status: 422 as const,
      code: 'validation_failed' as const,
      errors: [{ path: 'base_url', code: 'ai_base_url_required' }],
    };
  }

  const fingerprint = fingerprintApiKey(parsed.data.api_key);
  const duplicate = await deps.findByFingerprint({ workspaceId: ctx.workspaceId, fingerprint });
  if (duplicate !== null) {
    return {
      status: 409 as const,
      code: 'already_exists' as const,
      params: { label: duplicate.label },
    };
  }

  const inserted = await deps.insertCredential({
    workspaceId: ctx.workspaceId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    apiKeyEncrypted: encryptApiKey({
      workspaceId: ctx.workspaceId,
      apiKey: parsed.data.api_key,
    }),
    keyFingerprint: fingerprint,
    keyHint: hintFromApiKey(parsed.data.api_key),
    baseUrl: parsed.data.base_url ?? null,
    defaultModel: parsed.data.default_model,
    createdBy: ctx.actorId,
  });

  await deps.writeAuditLog({
    workspaceId: ctx.workspaceId,
    actorId: ctx.actorId,
    action: 'ai_credential_created',
    targetId: inserted.id,
    // Hodnota klíče se do auditu nikdy nedostane, ani redigovaná.
    metadata: { provider: parsed.data.provider, label: parsed.data.label },
  });

  return { status: 201 as const, body: { id: inserted.id } };
}

export type ListCredentialDeps = {
  listCredentials: (params: { workspaceId: string }) => Promise<CredentialRow[]>;
};

export async function handleListCredentials(ctx: ApiContext, deps: ListCredentialDeps) {
  const rows = await deps.listCredentials({ workspaceId: ctx.workspaceId });
  return { status: 200 as const, body: { data: rows.map(toPublicCredential) } };
}

export type TestCredentialDeps = {
  probe: (params: { credentialId: string }) => Promise<{ models?: string[] }>;
  markCredentialError: (params: { credentialId: string; code: string }) => Promise<void>;
  markCredentialOk: (params: { credentialId: string }) => Promise<void>;
};

export async function handleTestCredential(
  _ctx: ApiContext,
  params: { credentialId: string },
  deps: TestCredentialDeps,
) {
  try {
    const probe = await deps.probe({ credentialId: params.credentialId });
    await deps.markCredentialOk({ credentialId: params.credentialId });
    return { ok: true as const, models: probe.models ?? [] };
  } catch (error) {
    const mapped = mapProviderError(error);
    await deps.markCredentialError({ credentialId: params.credentialId, code: mapped.code });
    // Odpověď providera se uživateli nikdy nezobrazí syrová: může obsahovat
    // identifikátory účtu nebo části promptu.
    return { ok: false as const, error: mapped.code };
  }
}
