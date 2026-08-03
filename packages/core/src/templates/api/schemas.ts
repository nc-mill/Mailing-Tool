import { z } from '@hono/zod-openapi';

/**
 * Schémata veřejného API domény šablon.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. P08 (Task 42) psal holý
 * `Hono` router do `apps/web/src/server/routes/templates.router.ts`.
 * Repozitář má pro všechny domény jeden tvar: definice cest leží
 * v `packages/core/src/<domena>/api/*.routes.ts`, staví se přes
 * `@hono/zod-openapi` a mountují se v `apps/web/src/lib/api/openapi.ts`.
 * Druhý tvar by znamenal, že OpenAPI dokument vzniká ze dvou zdrojů,
 * a `ci:openapi-drift` na tom spadne. Tvar požadavků, odpovědí, oprávnění
 * i chybových kódů zůstává doslova ten z plánu.
 */

export const Uuid = z.uuid();

/**
 * Dokument šablony je otevřený blokový JSON. Schéma ho SCHVÁLNĚ nepopisuje
 * po polích: jediná pravda o jeho tvaru je JSON Schema
 * `packages/emails/schema/document.v1.schema.json`, které nad ním pouští ajv
 * uvnitř `validateTemplateDocument`. Kdyby se tvar opsal do zodu podruhé,
 * měl by projekt dvě definice téhož a rozešly by se při první změně modelu.
 */
export const TemplateDocument = z
  .record(z.string(), z.unknown())
  .openapi('TemplateDocument', { description: 'Blokový dokument šablony, schéma verze 1.' });

export const TemplateKindSchema = z.enum(['campaign', 'transactional', 'system']);

/** SHA-256 v hexu: 64 znaků, jen [0-9a-f]. */
export const DesignHash = z.string().regex(/^[0-9a-f]{64}$/i);

export const IssueSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    /** JSON Pointer na uzel dokumentu, například `/blocks/0/children/1/props/alt`. */
    pointer: z.string(),
    path: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TemplateIssue');

export const TemplateResponse = z
  .object({
    id: Uuid,
    name: z.string(),
    // Výčet je otevřený stejně jako u kampaní: klient musí neznámou hodnotu snést.
    kind: z.string(),
    schema_version: z.number().int(),
    design: TemplateDocument,
    design_hash: DesignHash,
    validation_state: z.string(),
    validation_errors: z.array(IssueSchema),
    current_version_id: Uuid.nullable(),
    used_fields: z.array(z.string()),
    /**
     * Náhled šablony nikdo nenastavuje, dokud nevznikne doména assetů
     * (P08, kapitola 40). Sloupec existuje, hodnota je zatím vždy `null`
     * a je to vědomé, ne opomenutí.
     */
    thumbnail_asset_id: Uuid.nullable(),
    starter: z.boolean(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .openapi('Template');

export const TemplateListResponse = z
  .object({
    items: z.array(TemplateResponse),
    next_cursor: z.string().nullable(),
  })
  .openapi('TemplateList');

export const CreateTemplateRequest = z
  .object({
    name: z.string().min(1).max(120),
    kind: TemplateKindSchema.optional(),
    document: TemplateDocument,
  })
  .strict()
  .openapi('CreateTemplateRequest');

export const PatchTemplateRequest = z
  .object({
    design: TemplateDocument.optional(),
    name: z.string().min(1).max(120).optional(),
    /**
     * Optimistický zámek. Kontroluje se TADY, ne až u porovnání bufferů:
     * `Buffer.from(x, 'hex')` z rozbitého vstupu vyrobí kratší buffer,
     * `.equals()` na něm vrátí false a klient by dostal 412 „změnil to někdo
     * jiný" místo pravdivého „poslal jsi nesmysl".
     */
    if_design_hash: DesignHash.optional(),
  })
  .strict()
  .openapi('PatchTemplateRequest');

/**
 * Data pro náhled, požadavek P08-R2 z kapitoly 9.2 plánu P12. Bez varianty
 * `no_name` nejde splnit kritérium 55: tlačítko „Kontakt bez jména" nemá jak
 * vyžádat náhled s prázdnými osobními údaji a nedá se nahradit výběrem
 * kontaktu, protože kontakt bez jména v projektu být nemusí.
 */
export const PreviewDataSchema = z
  .union([
    z
      .object({
        type: z.literal('sample'),
        variant: z.enum(['default', 'no_name']).default('default'),
      })
      .strict(),
    z.object({ type: z.literal('contact'), contact_id: Uuid }).strict(),
  ])
  .openapi('TemplatePreviewData');

export const PreviewRequest = z
  .object({
    preview_data: PreviewDataSchema.optional(),
    /**
     * Hotová data pro interpolaci. Zůstává kvůli plánu P08, který endpoint
     * takhle napsal, ale editor posílá `preview_data`. Když přijde obojí,
     * vyhrává `preview_data`, protože je konkrétnější.
     */
    render_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .openapi('TemplatePreviewRequest');

export const PreviewResponse = z
  .object({ html: z.string(), text: z.string() })
  .openapi('TemplatePreviewResponse');

export const CompileRequest = z
  .object({ campaign_id: Uuid.optional() })
  .strict()
  .openapi('TemplateCompileRequest');

export const CompileResponse = z
  .object({
    html: z.string(),
    text: z.string(),
    meta: z.object({
      contract_version: z.number().int(),
      renderer_version: z.string(),
      schema_version: z.number().int(),
      used_paths: z.array(z.string()),
      render_schema: z.record(z.string(), z.unknown()),
      links: z.array(z.record(z.string(), z.unknown())),
      asset_ids: z.array(z.string()),
      html_bytes: z.number().int(),
      text_bytes: z.number().int(),
      warnings: z.array(z.record(z.string(), z.unknown())),
      has_unsubscribe_link: z.boolean(),
      click_marker_count: z.number().int(),
      has_open_pixel_slot: z.boolean(),
    }),
  })
  .openapi('TemplateCompileResponse');

/**
 * Nález předodesílací kontroly. `message` je přeložený text z katalogu chyb,
 * `code` je to, podle čeho se rozhoduje klient (část 1, 4.2).
 */
export const FindingResponse = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    pointer: z.string().optional(),
    block_id: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TemplateFinding');

export const ValidateResponse = z
  .object({ findings: z.array(FindingResponse) })
  .openapi('TemplateValidateResponse');

export const FieldUsageResponse = z
  .object({ items: z.array(z.object({ id: Uuid, name: z.string() })) })
  .openapi('TemplateFieldUsageResponse');

export const VersionItem = z
  .object({
    id: Uuid,
    version: z.number().int(),
    label: z.string().nullable(),
    reason: z.string(),
    pinned: z.boolean(),
    design_hash: DesignHash,
    created_at: z.iso.datetime(),
  })
  .openapi('TemplateVersion');

export const VersionListResponse = z
  .object({ items: z.array(VersionItem) })
  .openapi('TemplateVersionList');

/**
 * Požadavek P08-R5. Parametr `add_test_prefix` z jeho znění tady SCHVÁLNĚ NENÍ.
 * Rozhodnutí D21 plánu P13 prefix ruší, a to je novější: „Prefix tedy končí
 * a UI u testovacího odeslání píše doslova, že mail dorazí přesně v té podobě,
 * v jaké ho dostanou příjemci." Parametr, který by nic nedělal, je mrtvá větev:
 * vypadá jako podporovaná možnost a při prvním pokusu ji použít se zjistí,
 * že se nikam nedostane.
 */
export const TestSendRequest = z
  .object({
    recipients: z.array(z.email()).min(1).max(5),
    preview_data: PreviewDataSchema.optional(),
  })
  .strict()
  .openapi('TemplateTestSendRequest');

export const TestSendResponse = z
  .object({
    created: z.number().int(),
    subject: z.string(),
  })
  .openapi('TemplateTestSendResponse');

export const CreateVersionRequest = z
  .object({ label: z.string().min(1).max(120).optional(), pinned: z.boolean().optional() })
  .strict()
  .openapi('CreateTemplateVersionRequest');
