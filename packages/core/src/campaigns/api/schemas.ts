import { z } from '@hono/zod-openapi';
import { campaignAudienceSchema } from '../types';

/**
 * Schémata veřejného API domény kampaní.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal sub-app do
 * `apps/web/src/server/routes/campaigns/**` a bral zod z balíčku `zod`.
 * Repozitář má pro všechny domény jeden tvar: definice cest leží v
 * `packages/core/src/<domena>/api/*.routes.ts`, staví se přes `@hono/zod-openapi`
 * a do aplikace se mountují v `apps/web/src/lib/api/openapi.ts`. Kontakty i segmenty
 * to tak dělají, takže druhý tvar by znamenal, že se OpenAPI dokument skládá
 * ze dvou různých zdrojů a `openapi-drift` na tom spadne.
 */

export const Uuid = z.uuid();

export const CampaignCountersSchema = z
  .object({
    total: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    delivered: z.number().int(),
    bounced: z.number().int(),
    complained: z.number().int(),
    pending: z.number().int(),
  })
  .openapi('CampaignCounters');

export const CampaignResponse = z
  .object({
    id: Uuid,
    name: z.string(),
    // Výčet je OTEVŘENÝ (část 4a, 4.1.1): schéma je proto `string`, ne `enum`.
    // Klient musí neznámou hodnotu tolerovat, a schéma, které ji zakáže, mu to bere.
    status: z.string(),
    subject: z.string(),
    preheader: z.string(),
    from_name: z.string(),
    from_email: z.string(),
    reply_to: z.string().nullable(),
    template_id: Uuid.nullable(),
    /**
     * Má kampaň vlastní dokument? Obrazovka nastavení podle toho pozná, že převzetí
     * jiné šablony obsah PŘEPÍŠE, a stihne se na to zeptat. Sám dokument se v odpovědi
     * neposílá. Dřív se tenhle příznak jmenoval `has_content`, což bylo zavádějící:
     * dokument, ve kterém není nic než patička, taky „je".
     */
    has_design: z.boolean(),
    /**
     * Má kampaň co odeslat? Pravda o obsahu, ne o existenci dokumentu: `false`
     * znamená e-mail, ve kterém není jediný obsahový blok, tedy nic než patička,
     * rozvržení a výplň. Kontrola před odesláním takovou kampaň nepustí.
     */
    has_content: z.boolean(),
    /** Kolik obsahových bloků dokument nese. Nula je totéž co `has_content: false`. */
    content_block_count: z.number().int(),
    audience: z.unknown(),
    audience_size: z.number().int().nullable(),
    audience_breakdown: z.unknown().nullable(),
    audience_built_at: z.string().nullable(),
    provider_id: Uuid.nullable(),
    sender_domain_id: Uuid.nullable(),
    /**
     * Předvolba odesílatele, ze které se pět polí výš předvyplnilo. `null`
     * znamená „vyplněno ručně". K odeslání potřeba není, obrazovka podle toho
     * jen ví, kterou položku ukázat vybranou v rozbalovacím seznamu.
     */
    sender_identity_id: Uuid.nullable(),
    unsubscribe_list_id: Uuid.nullable(),
    track_opens: z.boolean(),
    track_clicks: z.boolean(),
    revision: z.number().int(),
    release_at: z.string().nullable(),
    scheduled_at: z.string().nullable(),
    schedule_timezone: z.string().nullable(),
    pause_reason: z.unknown().nullable(),
    counters: CampaignCountersSchema,
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    paused_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Campaign');

export const CreateCampaignRequest = z
  .object({
    name: z.string().min(1).max(200),
    subject: z.string().max(255).optional(),
    preheader: z.string().max(255).optional(),
    from_name: z.string().max(200).optional(),
    from_email: z.email().optional(),
    reply_to: z.email().nullable().optional(),
    template_id: Uuid.nullable().optional(),
    audience: campaignAudienceSchema.optional(),
    provider_id: Uuid.nullable().optional(),
    sender_domain_id: Uuid.nullable().optional(),
    sender_identity_id: Uuid.nullable().optional(),
    unsubscribe_list_id: Uuid.nullable().optional(),
  })
  .strict()
  .openapi('CreateCampaignRequest');

export const PatchCampaignRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    subject: z.string().max(255).optional(),
    preheader: z.string().max(255).optional(),
    from_name: z.string().max(200).optional(),
    from_email: z.email().optional(),
    reply_to: z.email().nullable().optional(),
    template_id: Uuid.nullable().optional(),
    audience: campaignAudienceSchema.optional(),
    provider_id: Uuid.nullable().optional(),
    sender_domain_id: Uuid.nullable().optional(),
    sender_identity_id: Uuid.nullable().optional(),
    unsubscribe_list_id: Uuid.nullable().optional(),
    track_opens: z.boolean().optional(),
    track_clicks: z.boolean().optional(),
    scheduled_at: z.iso.datetime().nullable().optional(),
    schedule_timezone: z.string().nullable().optional(),
  })
  .strict()
  .openapi('PatchCampaignRequest');

export const SendCampaignRequest = z
  .object({
    /**
     * Povinný a musí se rovnat aktuálnímu odhadu publika s tolerancí 1 %. Chrání před
     * tím, aby uživatel odeslal na výrazně jiné publikum, než viděl na obrazovce,
     * protože mezitím doběhl import.
     */
    confirm_recipient_count: z.number().int().min(0),
  })
  .strict()
  .openapi('SendCampaignRequest');

export const ScheduleCampaignRequest = z
  .object({
    scheduled_at: z.iso.datetime(),
    timezone: z.string().min(1),
    confirm_recipient_count: z.number().int().min(0),
  })
  .strict()
  .openapi('ScheduleCampaignRequest');

/**
 * Odpověď kompilace kampaně. Vrací jen počty a příznaky, ne celé HTML: tělo se
 * čte náhledem a v odpovědi na akci by z něj byly stovky kilobajtů, které nikdo
 * nepoužije. `has_unsubscribe_link` je tam proto, že bez odhlašovacího odkazu
 * kampaň neprojde předletovou kontrolou, a je to jediný nález kompilace, který
 * uživatel může opravit v šabloně.
 */
/**
 * Vstup použití šablony. `template_id` je povinné a nikdy null: „zruš šablonu"
 * není operace, kterou by tahle cesta uměla, a `null` by jinak tiše smazal obsah.
 */
export const ApplyTemplateRequest = z
  .object({ template_id: Uuid })
  .strict()
  .openapi('ApplyTemplateRequest');

export const CompileCampaignResponse = z
  .object({
    id: Uuid,
    revision: z.number().int(),
    compiled_hash: z.string(),
    html_bytes: z.number().int(),
    link_count: z.number().int(),
    click_marker_count: z.number().int(),
    has_unsubscribe_link: z.boolean(),
  })
  .openapi('CampaignCompileResult');

/**
 * Odpověď použití šablony. `overwritten` říká, jestli kampaň PŘED voláním nějaký
 * obsah měla; obrazovka podle toho hlásí „obsah nahrazen" místo „obsah doplněn".
 *
 * `compiled` je NULLABLE a `null` je platná úspěšná odpověď: kampaň bez předmětu
 * se zkompilovat nedá, obsah se do ní ale zkopíroval. Dokud tu nullable nebyla,
 * vracelo převzetí obsahu 422 `campaign_subject_missing` na operaci, která se
 * povedla, a uživatel se z editoru vracel s dojmem, že o práci přišel.
 *
 * Píše se to jako sjednocení s `z.null()`, ne `.nullable()`. Generátor u odkazu
 * na pojmenované schéma `.nullable()` zahodí a v dokumentu zůstane holý `$ref`,
 * takže by kontrakt sliboval objekt tam, kde odpověď vrací `null`. Ověřeno
 * spuštěním generátoru na obou tvarech.
 */
export const ApplyTemplateResponse = z
  .object({
    overwritten: z.boolean(),
    compiled: z.union([CompileCampaignResponse, z.null()]),
  })
  .openapi('ApplyTemplateResult');

/**
 * Náhled ODESLANÉ podoby kampaně. Čte se z uložených sloupců, nikdy se
 * nekompiluje znovu: kompilace by u odeslané kampaně mohla vrátit něco jiného,
 * než co doopravdy odešlo (jiná šablona, jiný asset, jiná verze emitteru),
 * a přesně tohle má náhled vyvrátit.
 *
 * `html` je nullable a je to platná odpověď se stavem 200. Kampaň, která se
 * ještě nekompilovala, existuje, takže 404 by lhalo; obrazovka podle `null`
 * řekne „ještě se nekompilovalo", což je pravda.
 */
export const CampaignSentPreviewResponse = z
  .object({
    html: z.string().nullable(),
    text: z.string().nullable(),
    compiled_at: z.string().nullable(),
    revision: z.number().int(),
    status: z.string(),
    subject: z.string(),
  })
  .openapi('CampaignSentPreview');

export const FindingSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning']),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('CampaignFinding');

export const AudienceBreakdownSchema = z
  .object({
    raw: z.number().int(),
    eligible: z.number().int(),
    excluded_suppressed: z.number().int(),
    excluded_unsubscribed: z.number().int(),
    excluded_unconfirmed: z.number().int(),
    excluded_snoozed: z.number().int(),
    excluded_processing_restricted: z.number().int(),
    excluded_invalid_email: z.number().int(),
    excluded_deleted: z.number().int(),
    excluded_sample: z.number().int(),
    /**
     * Rozdíl, o který vylučující výběr zmenšil publikum. Ve schématu dřív chyběl,
     * i když ho `PreflightBreakdown` vrací vždycky a `EMPTY_BREAKDOWN` ho má taky.
     *
     * Za běhu se to neprojevilo, protože odpovědi se proti schématu nevalidují,
     * jenže generovaný klient tohle pole neznal. Kontrolní seznam připravenosti
     * ho sčítá do řádku „Vyloučeno", takže by součet přes klienta vyšel `NaN`.
     */
    excluded_by_selection: z.number().int(),
    duplicates_removed: z.number().int(),
  })
  .openapi('CampaignAudienceBreakdown');

export const PreflightResponse = z
  .object({
    can_send: z.boolean(),
    audience_estimate: z.number().int(),
    breakdown: AudienceBreakdownSchema,
    quota_remaining: z.number().int().nullable(),
    undo_window_seconds: z.number().int(),
    findings: z.array(FindingSchema),
    checked_at: z.string(),
  })
  .openapi('CampaignPreflight');

export const AudiencePreviewResponse = z
  .object({
    audience_estimate: z.number().int(),
    breakdown: AudienceBreakdownSchema,
    checked_at: z.string(),
  })
  .openapi('CampaignAudiencePreview');

export const ProgressResponse = z
  .object({
    campaign_id: Uuid,
    status: z.string(),
    counters: CampaignCountersSchema,
    ambiguous_count: z.number().int(),
    rate_per_second: z.number().nullable(),
    eta_seconds: z.number().int().nullable(),
    stalled: z.boolean(),
    pause_reason: z.unknown().nullable(),
    undo_remaining_seconds: z.number().int(),
    /**
     * Dorazila od poskytovatele aspoň jedna zpráva o doručení?
     *
     * Bez tohohle příznaku neumí obrazovka rozlišit „nikomu nic nedošlo" od
     * „doručenost neměříme", a obojí by ukazovala jako nulu. Ve vývoji je
     * druhý případ trvalý: odběr u Amazonu se nepotvrdí, protože náš webhook
     * běží na `localhost`.
     */
    delivery_events_seen: z.boolean(),
    /**
     * Skončila rozesílka? Obrazovka podle toho pozná, že se má PŘESTAT
     * obnovovat, aniž by musela znát výčet koncových stavů.
     */
    finished: z.boolean(),
    updated_at: z.string(),
  })
  .openapi('CampaignProgress');

export const MessageItem = z
  .object({
    id: Uuid,
    /**
     * `created_at` je součást klíče, ne kosmetika: `messages` je partitionovaná
     * podle něj, takže samotné `id` zprávu jednoznačně nezadresuje.
     */
    created_at: z.string(),
    status: z.string(),
    error_code: z.string().nullable(),
    provider_message_id: z.string().nullable(),
    sent_at: z.string().nullable(),
  })
  .openapi('CampaignMessage');

/** Ve stavu scheduled se smí měnit jen tyhle tři klíče, viz část 4a, 3.5.5. */
export { EDITABLE_WHILE_SCHEDULED } from '../control/schedule';
