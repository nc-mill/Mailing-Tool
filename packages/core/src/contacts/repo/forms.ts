import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { FormDefinitionSchema, type FormDefinition, type FormField } from '../forms/definition';
import { storeIpEnabled } from '../privacy';
import { decodePublicRef, encodePublicRef } from '../public/ids';

/**
 * Slug formuláře. Omezení `ck_forms__slug` žádá `^[a-z0-9]{16,32}$`, takže je to
 * neuhodnutelný náhodný řetězec, ne jméno zadané uživatelem: veřejný endpoint `/f/{slug}`
 * hledá bez znalosti projektu a čitelný slug by z něj udělal seznam zákazníků.
 */
export function generateFormSlug(): string {
  return randomBytes(16).toString('hex').slice(0, 24);
}

export type FormRow = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  fields: FormField[];
  customCss: string | null;
  listIds: string[];
  tagIds: string[];
  doubleOptIn: boolean;
  consentText: string | null;
  consentRequired: boolean;
  legalBasis: 'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in';
  honeypotField: string;
  minFillSeconds: number;
  allowedOrigins: string[];
  captchaProvider: 'none' | 'turnstile' | 'hcaptcha';
  redirectUrl: string | null;
  successMessage: Record<string, string>;
  active: boolean;
};

type RawFormRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  fields: unknown;
  custom_css: string | null;
  list_ids: string[];
  tag_ids: string[];
  double_opt_in: boolean;
  consent_text: string | null;
  consent_required: boolean;
  legal_basis: string;
  honeypot_field: string;
  min_fill_seconds: number;
  allowed_origins: string[];
  captcha_provider: string | null;
  redirect_url: string | null;
  success_message: unknown;
  active: boolean;
};

function toRow(raw: RawFormRow): FormRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    name: raw.name,
    slug: raw.slug,
    fields: (raw.fields ?? []) as FormField[],
    customCss: raw.custom_css,
    listIds: raw.list_ids ?? [],
    tagIds: raw.tag_ids ?? [],
    doubleOptIn: raw.double_opt_in,
    consentText: raw.consent_text,
    consentRequired: raw.consent_required,
    legalBasis: raw.legal_basis as FormRow['legalBasis'],
    honeypotField: raw.honeypot_field,
    minFillSeconds: raw.min_fill_seconds,
    allowedOrigins: raw.allowed_origins ?? [],
    captchaProvider: (raw.captcha_provider ?? 'none') as FormRow['captchaProvider'],
    redirectUrl: raw.redirect_url,
    successMessage: (raw.success_message ?? {}) as Record<string, string>,
    active: raw.active,
  };
}

const SELECT_FORM = sql`
  SELECT id, workspace_id, name, slug, fields, custom_css, list_ids, tag_ids, double_opt_in,
         consent_text, consent_required, legal_basis, honeypot_field, min_fill_seconds,
         allowed_origins, captcha_provider, redirect_url, success_message, active
    FROM forms
`;

export async function createForm(
  ctx: WorkspaceContext,
  input: Partial<FormDefinition> & { name: string },
): Promise<FormRow> {
  const definition = FormDefinitionSchema.parse(input);
  return withWorkspace(ctx, async (tx) => {
    const inserted = await tx.execute<RawFormRow>(sql`
      INSERT INTO forms (workspace_id, name, slug, fields, design, custom_css, list_ids, tag_ids,
                         double_opt_in, consent_text, consent_required, legal_basis,
                         honeypot_field, min_fill_seconds, allowed_origins, captcha_provider,
                         captcha_config, redirect_url, success_message, active)
      VALUES (${ctx.workspaceId}::uuid, ${definition.name}, ${generateFormSlug()},
              ${JSON.stringify(definition.fields)}::jsonb, ${JSON.stringify(definition.design)}::jsonb,
              ${definition.custom_css}, ${sql.param(definition.list_ids)}::uuid[], ${sql.param(definition.tag_ids)}::uuid[],
              ${definition.double_opt_in}, ${definition.consent_text}, ${definition.consent_required},
              ${definition.legal_basis}, ${definition.honeypot_field}, ${definition.min_fill_seconds},
              ${sql.param(definition.allowed_origins)}::text[], ${definition.captcha_provider},
              ${definition.captcha_config === null ? null : JSON.stringify(definition.captcha_config)}::jsonb,
              ${definition.redirect_url}, ${JSON.stringify(definition.success_message)}::jsonb,
              ${definition.active})
      RETURNING id, workspace_id, name, slug, fields, custom_css, list_ids, tag_ids, double_opt_in,
                consent_text, consent_required, legal_basis, honeypot_field, min_fill_seconds,
                allowed_origins, captcha_provider, redirect_url, success_message, active
    `);
    const row = toRow(inserted.rows[0]!);

    await writeAudit(tx, ctx, {
      action: 'form.created',
      targetType: 'form',
      targetId: row.id,
      metadata: { name: row.name, double_opt_in: row.doubleOptIn },
    });
    if (!row.doubleOptIn) {
      // Vypnuté dvojí potvrzení je rozhodnutí s následky (kdokoliv smí přihlásit cizí
      // adresu), takže má vlastní auditní akci a nezmizí mezi ostatními změnami.
      await writeAudit(tx, ctx, {
        action: 'form.double_opt_in_disabled',
        targetType: 'form',
        targetId: row.id,
        metadata: { name: row.name },
      });
    }
    return row;
  });
}

/** Veřejný identifikátor formuláře: projekt plus slug, viz `public/ids.ts`. */
export function publicFormRef(form: FormRow): string {
  return encodePublicRef({ workspaceId: form.workspaceId, value: form.slug });
}

export type PublicForm = FormRow & { ctx: WorkspaceContext };

/**
 * Načte formulář podle veřejného identifikátoru z adresy `/f/{ref}`.
 *
 * Vrací i systémový kontext projektu, protože všechno další (zápis kontaktu, přihlášení,
 * souhlas, záznam odeslání) musí běžet pod ním. Vyrábí ho `createSystemContext` z P04,
 * tedy legitimní továrna; `unsafeWorkspaceContext` z `@mlain/db` se tady nepoužívá.
 */
export async function loadPublicForm(ref: string): Promise<PublicForm | null> {
  const parsed = decodePublicRef(ref);
  if (parsed === null) return null;
  if (!/^[a-z0-9]{16,32}$/.test(parsed.value)) return null;

  const ctx = createSystemContext(parsed.workspaceId, 'forms.public');
  const found = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<RawFormRow>(sql`
      ${SELECT_FORM}
       WHERE workspace_id = ${parsed.workspaceId}::uuid AND slug = ${parsed.value}
    `);
    return rows[0] ?? null;
  });
  if (found === null) return null;
  return { ...toRow(found), ctx };
}

export async function findFormById(ctx: WorkspaceContext, id: string): Promise<FormRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<RawFormRow>(sql`
      ${SELECT_FORM} WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
    `);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  });
}

export type SubmissionStatus = 'accepted' | 'rejected' | 'dropped';

export type RecordSubmissionInput = {
  formId: string;
  status: SubmissionStatus;
  errorCode?: string | null;
  contactId?: string | null;
  /**
   * U chyby zůstává prázdný. Payload odmítnutého odeslání je obsah z internetu a nemá
   * důvod ležet v databázi; u přijatého je to naopak důkaz, co člověk vyplnil.
   */
  payload?: Record<string, unknown>;
  pageUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  tx?: Tx;
};

/**
 * Záznam o odeslání. Píše se u KAŽDÉHO odeslání, i u tichého zahození: bez něj by
 * provozovatel neměl jak zjistit, že mu formulář zahazuje i lidi.
 */
export async function recordSubmission(
  ctx: WorkspaceContext,
  input: RecordSubmissionInput,
): Promise<void> {
  const run = async (tx: Tx): Promise<void> => {
    const storeIp = await storeIpEnabled(tx, ctx);
    await tx.execute(sql`
      INSERT INTO form_submissions (workspace_id, form_id, contact_id, status, error_code,
                                    payload, page_url, ip, user_agent)
      VALUES (${ctx.workspaceId}::uuid, ${input.formId}::uuid, ${input.contactId ?? null}::uuid,
              ${input.status}, ${input.errorCode ?? null},
              ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.pageUrl ?? null},
              ${storeIp ? (input.ip ?? null) : null}::inet, ${input.userAgent ?? null})
    `);
    if (input.status === 'accepted') {
      await tx.execute(sql`
        UPDATE forms SET submission_count = submission_count + 1, updated_at = now()
         WHERE id = ${input.formId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      `);
    }
  };
  return input.tx !== undefined ? run(input.tx) : withWorkspace(ctx, run);
}

export type SubmissionRow = {
  id: string;
  status: SubmissionStatus;
  error_code: string | null;
  payload: Record<string, unknown>;
  contact_id: string | null;
};

export async function lastSubmission(
  ctx: WorkspaceContext,
  formId: string,
): Promise<SubmissionRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<SubmissionRow>(sql`
      SELECT id, status, error_code, payload, contact_id
        FROM form_submissions
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND form_id = ${formId}::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
}

/** Formulář, který neexistuje nebo je vypnutý, se navenek chová stejně jako neexistující. */
export function assertActiveForm(form: PublicForm | null): PublicForm {
  if (form === null || !form.active) throw new ApiError('not_found');
  return form;
}
