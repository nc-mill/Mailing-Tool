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
  /** Šablona e-mailu, který přijde po vyplnění. NULL = formulář nic neposílá. */
  deliveryTemplateId: string | null;
  /** Počítadlo přijatých odeslání. Zvyšuje ho `recordSubmission`, nikdy se nesnižuje. */
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
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
  delivery_template_id: string | null;
  submission_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * Časy vydává ovladač u syrového SQL jako řetězec, ne jako `Date` (týž nález je
 * u `ConsentRow` v `repo/consents.ts`). Kdyby se na hodnotě volalo rovnou
 * `.toISOString()`, spadlo by to za běhu na TypeError a typová kontrola by to
 * nechytila, takže se převod dělá na jednom místě.
 */
function toIsoString(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

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
    deliveryTemplateId: raw.delivery_template_id,
    // bigint vydává ovladač jako řetězec, aby nepřišel o přesnost. Počet odeslání
    // se vejde do bezpečného rozsahu čísla, tak se převádí tady a ne u každého volajícího.
    submissionCount: Number(raw.submission_count ?? 0),
    createdAt: toIsoString(raw.created_at),
    updatedAt: toIsoString(raw.updated_at),
  };
}

/** Sloupce, které umí `toRow`. Drží se pohromadě, aby se SELECT a RETURNING nerozešly. */
const FORM_COLUMNS = sql`
  id, workspace_id, name, slug, fields, custom_css, list_ids, tag_ids, double_opt_in,
  consent_text, consent_required, legal_basis, honeypot_field, min_fill_seconds,
  allowed_origins, captcha_provider, redirect_url, success_message, active,
  delivery_template_id, submission_count, created_at, updated_at
`;

const SELECT_FORM = sql`SELECT ${FORM_COLUMNS} FROM forms`;

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
                         captcha_config, redirect_url, success_message, active,
                         delivery_template_id)
      VALUES (${ctx.workspaceId}::uuid, ${definition.name}, ${generateFormSlug()},
              ${JSON.stringify(definition.fields)}::jsonb, ${JSON.stringify(definition.design)}::jsonb,
              ${definition.custom_css}, ${sql.param(definition.list_ids)}::uuid[], ${sql.param(definition.tag_ids)}::uuid[],
              ${definition.double_opt_in}, ${definition.consent_text}, ${definition.consent_required},
              ${definition.legal_basis}, ${definition.honeypot_field}, ${definition.min_fill_seconds},
              ${sql.param(definition.allowed_origins)}::text[], ${definition.captcha_provider},
              ${definition.captcha_config === null ? null : JSON.stringify(definition.captcha_config)}::jsonb,
              ${definition.redirect_url}, ${JSON.stringify(definition.success_message)}::jsonb,
              ${definition.active}, ${definition.delivery_template_id}::uuid)
      RETURNING ${FORM_COLUMNS}
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

/**
 * Výpis formulářů projektu, nejnovější první.
 *
 * Bez stránkování schválně: formulářů má projekt jednotky, ne tisíce, a krycí index
 * `idx_forms__ws_created` je přesně na tohle pořadí. Kdyby jich přibylo, patří sem
 * kurzor, ne vyšší strop.
 */
export async function listForms(
  ctx: WorkspaceContext,
  options: { includeInactive?: boolean } = {},
): Promise<FormRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<RawFormRow>(sql`
      ${SELECT_FORM}
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         ${options.includeInactive === false ? sql`AND active` : sql``}
       ORDER BY created_at DESC, id DESC
    `);
    return rows.map(toRow);
  });
}

/**
 * Úprava formuláře. Vstup je ČÁSTEČNÝ, ale zápis je celý: aktuální řádek se načte,
 * změny se do něj vloží a teprve výsledek projde `FormDefinitionSchema`.
 *
 * Je to schválně tahle cesta, ne poskládaný UPDATE jen ze změněných sloupců. Definice
 * formuláře je jeden celek se vzájemnými závislostmi (pole versus katalog vlastních polí,
 * dvojí potvrzení versus seznamy) a částečný zápis by schéma obešel: uložilo by se něco,
 * co jako celek neprojde validací.
 */
export async function updateForm(
  ctx: WorkspaceContext,
  id: string,
  patch: Partial<FormDefinition>,
): Promise<FormRow> {
  return withWorkspace(ctx, async (tx) => {
    const found = await tx.execute<RawFormRow>(sql`
      ${SELECT_FORM} WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
    `);
    const raw = found.rows[0];
    if (raw === undefined) throw new ApiError('not_found');
    const current = toRow(raw);

    const definition = FormDefinitionSchema.parse({
      name: current.name,
      fields: current.fields,
      // `design` a `captcha_config` se přes API neupravují a v `FormRow` nejsou.
      // Do zápisu se proto neberou z načteného řádku, ale nechávají se v databázi být.
      custom_css: current.customCss,
      list_ids: current.listIds,
      tag_ids: current.tagIds,
      double_opt_in: current.doubleOptIn,
      consent_text: current.consentText,
      consent_required: current.consentRequired,
      legal_basis: current.legalBasis,
      honeypot_field: current.honeypotField,
      min_fill_seconds: current.minFillSeconds,
      allowed_origins: current.allowedOrigins,
      captcha_provider: current.captchaProvider,
      redirect_url: current.redirectUrl,
      delivery_template_id: current.deliveryTemplateId,
      success_message: current.successMessage,
      active: current.active,
      ...patch,
    });

    const updated = await tx.execute<RawFormRow>(sql`
      UPDATE forms
         SET name = ${definition.name},
             fields = ${JSON.stringify(definition.fields)}::jsonb,
             custom_css = ${definition.custom_css},
             list_ids = ${sql.param(definition.list_ids)}::uuid[],
             tag_ids = ${sql.param(definition.tag_ids)}::uuid[],
             double_opt_in = ${definition.double_opt_in},
             consent_text = ${definition.consent_text},
             consent_required = ${definition.consent_required},
             legal_basis = ${definition.legal_basis},
             honeypot_field = ${definition.honeypot_field},
             min_fill_seconds = ${definition.min_fill_seconds},
             allowed_origins = ${sql.param(definition.allowed_origins)}::text[],
             captcha_provider = ${definition.captcha_provider},
             redirect_url = ${definition.redirect_url},
             delivery_template_id = ${definition.delivery_template_id}::uuid,
             success_message = ${JSON.stringify(definition.success_message)}::jsonb,
             active = ${definition.active},
             updated_at = now()
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
      RETURNING ${FORM_COLUMNS}
    `);
    const row = toRow(updated.rows[0]!);

    await writeAudit(tx, ctx, {
      action: 'form.updated',
      targetType: 'form',
      targetId: id,
      metadata: { name: row.name },
    });
    // Stejná zvláštní auditní akce jako při založení. Vypnuté dvojí potvrzení znamená,
    // že kdokoliv smí přihlásit cizí adresu, a v záplavě přejmenování by zaniklo.
    if (current.doubleOptIn && !row.doubleOptIn) {
      await writeAudit(tx, ctx, {
        action: 'form.double_opt_in_disabled',
        targetType: 'form',
        targetId: id,
        metadata: { name: row.name },
      });
    }
    return row;
  });
}

/**
 * Smazání formuláře i s jeho odesláními (`form_submissions` má kaskádu).
 *
 * Formuláře nemají `deleted_at`, takže archivace ve smyslu seznamů tu neexistuje.
 * Odpovídající krok je POZASTAVENÍ (`active = false`): formulář zůstane i s historií
 * odeslání a veřejná adresa se navenek chová jako neexistující. Rozhraní proto nabízí
 * obojí a mazání staví jako nevratné.
 */
export async function deleteForm(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ name: string }>(sql`
      DELETE FROM forms
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
      RETURNING name
    `);
    const row = rows[0];
    if (row === undefined) throw new ApiError('not_found');

    await writeAudit(tx, ctx, {
      action: 'form.deleted',
      targetType: 'form',
      targetId: id,
      metadata: { name: row.name },
    });
  });
}

export type FormSubmissionStats = {
  /** Kdy dorazilo PRVNÍ přijaté odeslání. Jediná odpověď na „funguje to vložení?". */
  firstAcceptedAt: string | null;
  lastAcceptedAt: string | null;
  accepted30d: number;
};

/**
 * Statistika odeslání pro jeden formulář. Počítá se jen z přijatých: zahozené pokusy
 * robotů nejsou přihlášení a v obrazovce by z nich bylo falešné „funguje to".
 */
export async function formSubmissionStats(
  ctx: WorkspaceContext,
  formId: string,
): Promise<FormSubmissionStats> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      first_at: Date | string | null;
      last_at: Date | string | null;
      accepted_30d: string | number;
    }>(sql`
      SELECT min(created_at) AS first_at,
             max(created_at) AS last_at,
             count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS accepted_30d
        FROM form_submissions
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND form_id = ${formId}::uuid
         AND status = 'accepted'
    `);
    const row = rows[0];
    return {
      firstAcceptedAt: row?.first_at == null ? null : toIsoString(row.first_at),
      lastAcceptedAt: row?.last_at == null ? null : toIsoString(row.last_at),
      accepted30d: Number(row?.accepted_30d ?? 0),
    };
  });
}

/**
 * Počty přijatých odeslání za posledních 30 dní pro VŠECHNY formuláře projektu naráz.
 *
 * Jeden seskupený dotaz, ne dotaz na formulář. Seznam formulářů ten údaj potřebuje
 * u každého řádku a cyklus přes `formSubmissionStats` by z pěti formulářů udělal
 * pět kol na databázi kvůli jednomu číslu.
 */
export async function acceptedCounts30d(ctx: WorkspaceContext): Promise<Map<string, number>> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ form_id: string; total: string | number }>(sql`
      SELECT form_id, count(*) AS total
        FROM form_submissions
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND status = 'accepted'
         AND created_at >= now() - interval '30 days'
       GROUP BY form_id
    `);
    return new Map(rows.map((row) => [row.form_id, Number(row.total)]));
  });
}

/**
 * Formulář, přes který se kontakt naposledy přihlásil.
 *
 * Odpovídá na otázku „komu mám po potvrzení poslat slíbený e-mail": potvrzovací
 * odkaz nese jen kontakt a seznam, o formuláři neví nic. Hledá se poslední PŘIJATÉ
 * odeslání, protože jeden člověk může vyplnit víc formulářů a slíbený soubor patří
 * k tomu poslednímu.
 */
export async function findFormOfLastSubmission(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<FormRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<RawFormRow>(sql`
      SELECT ${FORM_COLUMNS}
        FROM forms
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND id = (
           SELECT form_id FROM form_submissions
            WHERE workspace_id = ${ctx.workspaceId}::uuid
              AND contact_id = ${contactId}::uuid
              AND status = 'accepted'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         )
    `);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  });
}

export type SubmissionListRow = {
  id: string;
  status: SubmissionStatus;
  errorCode: string | null;
  contactId: string | null;
  pageUrl: string | null;
  createdAt: string;
};

/** Poslední odeslání formuláře, nejnovější první. Podklad pro blok „Zkouška". */
export async function listSubmissions(
  ctx: WorkspaceContext,
  formId: string,
  options: { limit: number; status?: SubmissionStatus },
): Promise<SubmissionListRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      status: SubmissionStatus;
      error_code: string | null;
      contact_id: string | null;
      page_url: string | null;
      created_at: Date | string;
    }>(sql`
      SELECT id, status, error_code, contact_id, page_url, created_at
        FROM form_submissions
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND form_id = ${formId}::uuid
         ${options.status === undefined ? sql`` : sql`AND status = ${options.status}`}
       ORDER BY created_at DESC, id DESC
       LIMIT ${options.limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      errorCode: row.error_code,
      contactId: row.contact_id,
      pageUrl: row.page_url,
      createdAt: toIsoString(row.created_at),
    }));
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
