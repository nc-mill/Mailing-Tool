CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'secret' NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" "bytea",
	"previous_secret_hash" "bytea",
	"previous_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_api_keys__kind" CHECK ("api_keys"."kind" IN ('secret','public')),
	CONSTRAINT "ck_api_keys__secret_hash" CHECK (
    ("api_keys"."kind" = 'secret' AND "api_keys"."secret_hash" IS NOT NULL) OR
    ("api_keys"."kind" = 'public' AND "api_keys"."secret_hash" IS NULL)),
	CONSTRAINT "ck_api_keys__prefix" CHECK (
    ("api_keys"."kind" = 'secret' AND "api_keys"."prefix" ~ '^[a-z2-7]{8}$') OR
    ("api_keys"."kind" = 'public' AND "api_keys"."prefix" ~ '^[a-z2-7]{16}$')),
	CONSTRAINT "ck_api_keys__previous_secret" CHECK (
    ("api_keys"."previous_secret_hash" IS NULL AND "api_keys"."previous_expires_at" IS NULL) OR
    ("api_keys"."previous_secret_hash" IS NOT NULL AND "api_keys"."previous_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invitations__role" CHECK ("invitations"."role" IN ('owner','admin','editor','viewer'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_memberships" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "ck_memberships__role" CHECK ("memberships"."role" IN ('owner','admin','editor','viewer'))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_secret" "bytea" NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'cs' NOT NULL,
	"timezone" text DEFAULT 'Europe/Prague' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_users__status" CHECK ("users"."status" IN ('active','suspended')),
	CONSTRAINT "ck_users__locale" CHECK ("users"."locale" ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$')
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'cs' NOT NULL,
	"timezone" text DEFAULT 'Europe/Prague' NOT NULL,
	"address_form" text DEFAULT 'formal' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_workspaces__slug" CHECK ("workspaces"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "ck_workspaces__locale" CHECK ("workspaces"."locale" ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'),
	CONSTRAINT "ck_workspaces__address_form" CHECK ("workspaces"."address_form" IN ('formal','informal'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_idempotency_keys" PRIMARY KEY("workspace_id","key"),
	CONSTRAINT "ck_idempotency_keys__status" CHECK ("idempotency_keys"."status" IN ('in_progress','completed')),
	CONSTRAINT "ck_idempotency_keys__key_len" CHECK (length("idempotency_keys"."key") BETWEEN 8 AND 255)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_rate_limits" PRIMARY KEY("bucket","window_start"),
	CONSTRAINT "ck_rate_limits__bucket" CHECK ("rate_limits"."bucket" ~
    '^(user|workspace|ip|global):[^:]{1,128}:[a-z0-9_]{1,32}$'),
	CONSTRAINT "ck_rate_limits__hits" CHECK ("rate_limits"."hits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "secret_key_generations" (
	"key_id" smallint PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"introduced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "ck_secret_key_generations__key_id" CHECK ("secret_key_generations"."key_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"installation_id" uuid DEFAULT uuidv7() NOT NULL,
	"schema_version" integer NOT NULL,
	"secret_key_fingerprint" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_system_settings__singleton" CHECK ("system_settings"."id" = true)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"event_types" text[] NOT NULL,
	"secret_encrypted" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_webhook_endpoints__status" CHECK ("webhook_endpoints"."status" IN ('active','disabled')),
	CONSTRAINT "ck_webhook_endpoints__event_types" CHECK (cardinality("webhook_endpoints"."event_types") BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"scope_list_id" uuid,
	"status" text NOT NULL,
	"legal_basis" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"consent_text" text,
	"consent_text_hash" "bytea",
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_by" text DEFAULT 'system' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_consents__purpose" CHECK ("consents"."purpose" IN
    ('email_marketing','analytics','personalization','profiling','third_party')),
	CONSTRAINT "ck_consents__status" CHECK ("consents"."status" IN ('granted','withdrawn')),
	CONSTRAINT "ck_consents__legal_basis" CHECK ("consents"."legal_basis" IN
    ('consent','legitimate_interest','contract','soft_opt_in')),
	CONSTRAINT "ck_consents__source" CHECK ("consents"."source" IN
    ('form','import','api','double_opt_in','admin','webhook','preference_center',
     'one_click','complaint','objection','reactivation','migration'))
);
--> statement-breakpoint
CREATE TABLE "contact_consent_state" (
	"contact_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"legal_basis" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"last_consent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_contact_consent_state" PRIMARY KEY("contact_id","purpose"),
	CONSTRAINT "ck_contact_consent_state__status" CHECK ("contact_consent_state"."status" IN ('granted','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "contact_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"subject_editable" boolean DEFAULT false NOT NULL,
	"indexed" boolean DEFAULT false NOT NULL,
	"index_state" text DEFAULT 'none' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_contact_fields__key" CHECK ("contact_fields"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "ck_contact_fields__type" CHECK ("contact_fields"."type" IN
    ('text','long_text','number','boolean','date','datetime',
     'enum','multi_enum','url','email','phone')),
	CONSTRAINT "ck_contact_fields__index_state" CHECK ("contact_fields"."index_state" IN ('none','building','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_contact_tags" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"email_fingerprints" "bytea"[] DEFAULT '{}'::bytea[] NOT NULL,
	"email_domain" text GENERATED ALWAYS AS (lower(split_part(email::text, '@', 2))) STORED,
	"status" text DEFAULT 'active' NOT NULL,
	"processing_restricted" boolean DEFAULT false NOT NULL,
	"first_name" text,
	"last_name" text,
	"middle_name" text,
	"title_prefix" text,
	"title_suffix" text,
	"first_name_key" text,
	"last_name_key" text,
	"search_key" text,
	"gender" text DEFAULT 'unknown' NOT NULL,
	"gender_source" text DEFAULT 'none' NOT NULL,
	"first_name_vocative" text,
	"last_name_vocative" text,
	"vocative_confidence" text DEFAULT 'none' NOT NULL,
	"vocative_locked" boolean DEFAULT false NOT NULL,
	"vocative_locked_for" text,
	"vocative_reviewed_at" timestamp with time zone,
	"vocative_reviewed_by" uuid,
	"greeting" text DEFAULT '' NOT NULL,
	"greeting_neutral" text DEFAULT '' NOT NULL,
	"name_split_confidence" text DEFAULT 'none' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text DEFAULT 'cs' NOT NULL,
	"timezone" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"external_id" text,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"search_text" text GENERATED ALWAYS AS (lower(
    coalesce(email::text,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,''))) STORED,
	CONSTRAINT "ck_contacts__status" CHECK ("contacts"."status" IN
    ('active','unconfirmed','unsubscribed','bounced','complained','deleted')),
	CONSTRAINT "ck_contacts__gender" CHECK ("contacts"."gender" IN ('female','male','unknown')),
	CONSTRAINT "ck_contacts__gender_source" CHECK ("contacts"."gender_source" IN
    ('explicit','workspace_override','surname_rule','surname_rule_translit',
     'given_name_dict','library_heuristic','manual','none')),
	CONSTRAINT "ck_contacts__vocative_confidence" CHECK ("contacts"."vocative_confidence" IN ('high','low','none')),
	CONSTRAINT "ck_contacts__name_split_confidence" CHECK ("contacts"."name_split_confidence" IN ('high','low','none')),
	CONSTRAINT "ck_contacts__source" CHECK ("contacts"."source" IN
    ('manual','import','api','form','webhook','double_opt_in','migration')),
	CONSTRAINT "ck_contacts__locale" CHECK ("contacts"."locale" ~ '^[a-zA-Z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$'),
	CONSTRAINT "ck_contacts__email_len" CHECK (char_length("contacts"."email"::text) BETWEEN 3 AND 254),
	CONSTRAINT "ck_contacts__attributes_object" CHECK (jsonb_typeof("contacts"."attributes") = 'object'),
	CONSTRAINT "ck_contacts__attributes_sane" CHECK (pg_column_size("contacts"."attributes") <= 4194304)
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"encoding" text DEFAULT 'utf-8-bom' NOT NULL,
	"delimiter" text DEFAULT ';' NOT NULL,
	"status" text NOT NULL,
	"row_count" bigint,
	"storage_key" text,
	"byte_size" bigint,
	"download_token_hash" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_exports__kind" CHECK ("exports"."kind" IN
    ('contacts','suppressions','import_errors','gdpr_subject')),
	CONSTRAINT "ck_exports__format" CHECK ("exports"."format" IN ('csv','ndjson')),
	CONSTRAINT "ck_exports__encoding" CHECK ("exports"."encoding" IN ('utf-8-bom','utf-8','windows-1250')),
	CONSTRAINT "ck_exports__status" CHECK ("exports"."status" IN
    ('queued','running','completed','failed','expired'))
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text NOT NULL,
	"error_code" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_url" text,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_form_submissions__status" CHECK ("form_submissions"."status" IN ('accepted','rejected','dropped'))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_css" text,
	"list_ids" uuid[] DEFAULT '{}' NOT NULL,
	"tag_ids" uuid[] DEFAULT '{}' NOT NULL,
	"double_opt_in" boolean DEFAULT true NOT NULL,
	"consent_text" text,
	"consent_required" boolean DEFAULT true NOT NULL,
	"legal_basis" text DEFAULT 'consent' NOT NULL,
	"honeypot_field" text DEFAULT 'website' NOT NULL,
	"min_fill_seconds" smallint DEFAULT 2 NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"captcha_provider" text,
	"captcha_config" jsonb,
	"redirect_url" text,
	"success_message" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"submission_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_forms__slug" CHECK ("forms"."slug" ~ '^[a-z0-9]{16,32}$'),
	CONSTRAINT "ck_forms__custom_css_len" CHECK ("forms"."custom_css" IS NULL OR char_length("forms"."custom_css") <= 20000),
	CONSTRAINT "ck_forms__min_fill_seconds" CHECK ("forms"."min_fill_seconds" BETWEEN 0 AND 60),
	CONSTRAINT "ck_forms__captcha_provider" CHECK ("forms"."captcha_provider" IS NULL OR
    "forms"."captcha_provider" IN ('none','turnstile','hcaptcha'))
);
--> statement-breakpoint
CREATE TABLE "gdpr_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"subject_email_fingerprint" "bytea" NOT NULL,
	"subject_email_fingerprint_key_id" smallint NOT NULL,
	"type" text NOT NULL,
	"mode" text,
	"status" text NOT NULL,
	"channel" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"extended_until" timestamp with time zone,
	"extension_reason" text,
	"verified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"export_id" uuid,
	"affected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rejection_reason" text,
	"requested_by" text,
	"processed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_gdpr_requests__type" CHECK ("gdpr_requests"."type" IN
    ('access','portability','erasure','rectification','restriction','objection')),
	CONSTRAINT "ck_gdpr_requests__mode" CHECK ("gdpr_requests"."mode" IS NULL OR "gdpr_requests"."mode" IN ('anonymize','purge')),
	CONSTRAINT "ck_gdpr_requests__status" CHECK ("gdpr_requests"."status" IN
    ('received','verifying','processing','completed','rejected','failed')),
	CONSTRAINT "ck_gdpr_requests__channel" CHECK ("gdpr_requests"."channel" IN ('preference_center','admin','api'))
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"import_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"row_number" bigint NOT NULL,
	"severity" text NOT NULL,
	"column_name" text,
	"error_code" text NOT NULL,
	"error_detail" text,
	"raw_line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_import_errors__severity" CHECK ("import_errors"."severity" IN ('error','warning'))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text,
	"byte_size" bigint NOT NULL,
	"content_sha256" "bytea" NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"encoding" text,
	"encoding_source" text,
	"delimiter" text,
	"quote_char" text DEFAULT '"' NOT NULL,
	"has_header" boolean DEFAULT true NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" bigint,
	"checkpoint_row" bigint DEFAULT 0 NOT NULL,
	"checkpoint_byte" bigint DEFAULT 0 NOT NULL,
	"processed_rows" bigint DEFAULT 0 NOT NULL,
	"created_rows" bigint DEFAULT 0 NOT NULL,
	"updated_rows" bigint DEFAULT 0 NOT NULL,
	"skipped_rows" bigint DEFAULT 0 NOT NULL,
	"suppressed_rows" bigint DEFAULT 0 NOT NULL,
	"error_rows" bigint DEFAULT 0 NOT NULL,
	"warning_rows" bigint DEFAULT 0 NOT NULL,
	"review_rows" bigint DEFAULT 0 NOT NULL,
	"stored_error_count" bigint DEFAULT 0 NOT NULL,
	"resume_from_import_id" uuid,
	"error_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_code" text,
	"failure_detail" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"file_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_imports__byte_size" CHECK ("imports"."byte_size" > 0),
	CONSTRAINT "ck_imports__stored_error_count" CHECK ("imports"."stored_error_count" >= 0),
	CONSTRAINT "ck_imports__resume_not_self" CHECK ("imports"."resume_from_import_id" IS DISTINCT FROM "imports"."id"),
	CONSTRAINT "ck_imports__status" CHECK ("imports"."status" IN
    ('pending','validating','previewing','importing','completed',
     'completed_with_errors','failed','cancelled')),
	CONSTRAINT "ck_imports__encoding_source" CHECK ("imports"."encoding_source" IS NULL OR
    "imports"."encoding_source" IN ('bom','utf8_validation','score','manual')),
	CONSTRAINT "ck_imports__delimiter" CHECK ("imports"."delimiter" IS NULL OR
    "imports"."delimiter" IN (';', ',', E'\t', '|'))
);
--> statement-breakpoint
CREATE TABLE "inbound_dedup" (
	"workspace_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"delivery_id" uuid NOT NULL,
	"delivery_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_inbound_dedup" PRIMARY KEY("workspace_id","endpoint_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"signature_mode" text DEFAULT 'hmac_sha256' NOT NULL,
	"signature_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_encrypted" text,
	"ip_allowlist" "inet"[] DEFAULT '{}'::inet[] NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_inbound_endpoints__slug" CHECK ("inbound_endpoints"."slug" ~ '^[a-z0-9]{24,40}$'),
	CONSTRAINT "ck_inbound_endpoints__signature_mode" CHECK ("inbound_endpoints"."signature_mode" IN
    ('none','hmac_sha256','shared_secret','basic'))
);
--> statement-breakpoint
CREATE TABLE "list_subscriptions" (
	"contact_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_reason" text,
	"unsubscribe_campaign_id" uuid,
	"snooze_until" timestamp with time zone,
	"confirmation_sent_at" timestamp with time zone,
	"confirmation_resends" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_list_subscriptions" PRIMARY KEY("contact_id","list_id"),
	CONSTRAINT "ck_list_subscriptions__status" CHECK ("list_subscriptions"."status" IN
    ('pending','confirmed','unsubscribed','bounced','complained')),
	CONSTRAINT "ck_list_subscriptions__source" CHECK ("list_subscriptions"."source" IN
    ('manual','import','api','form','webhook','preference_center','double_opt_in','migration')),
	CONSTRAINT "ck_list_subscriptions__unsubscribe_reason" CHECK ("list_subscriptions"."unsubscribe_reason" IS NULL OR
    "list_subscriptions"."unsubscribe_reason" IN ('link','one_click','preference_center','api','manual',
                               'complaint','bounce','global','objection','import'))
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"opt_in" text DEFAULT 'double' NOT NULL,
	"confirmation_mode" text DEFAULT 'two_step' NOT NULL,
	"confirmation_ttl_hours" integer DEFAULT 168 NOT NULL,
	"confirmation_template_id" uuid,
	"welcome_template_id" uuid,
	"send_welcome" boolean DEFAULT false NOT NULL,
	"confirmation_max_resends" smallint DEFAULT 3 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_lists__name_len" CHECK (char_length("lists"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_lists__opt_in" CHECK ("lists"."opt_in" IN ('single','double')),
	CONSTRAINT "ck_lists__confirmation_mode" CHECK ("lists"."confirmation_mode" IN ('one_step','two_step')),
	CONSTRAINT "ck_lists__confirmation_ttl" CHECK ("lists"."confirmation_ttl_hours" BETWEEN 1 AND 720),
	CONSTRAINT "ck_lists__confirmation_max_resends" CHECK ("lists"."confirmation_max_resends" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "name_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name_key" text NOT NULL,
	"gender" text,
	"vocative" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_name_overrides__kind" CHECK ("name_overrides"."kind" IN ('first','last')),
	CONSTRAINT "ck_name_overrides__gender" CHECK ("name_overrides"."gender" IS NULL OR
    "name_overrides"."gender" IN ('female','male','unknown')),
	CONSTRAINT "ck_name_overrides__has_value" CHECK ("name_overrides"."gender" IS NOT NULL OR "name_overrides"."vocative" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target" text NOT NULL,
	"retain_days" integer NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_retention_policies__target" CHECK ("retention_policies"."target" IN
    ('import_files','import_errors','form_submissions','inbound_deliveries',
     'unconfirmed_subscriptions','inactive_contacts','exports')),
	CONSTRAINT "ck_retention_policies__retain_days" CHECK ("retention_policies"."retain_days" BETWEEN 1 AND 3650),
	CONSTRAINT "ck_retention_policies__action" CHECK ("retention_policies"."action" IN ('delete','anonymize'))
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid,
	"target" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"scanned" bigint DEFAULT 0 NOT NULL,
	"affected" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_detail" text,
	CONSTRAINT "ck_retention_runs__status" CHECK ("retention_runs"."status" IN
    ('running','completed','partial','failed'))
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_segment_members" PRIMARY KEY("segment_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'dynamic' NOT NULL,
	"preset_key" text,
	"definition" jsonb NOT NULL,
	"definition_hash" "bytea" NOT NULL,
	"ast_version" smallint DEFAULT 1 NOT NULL,
	"cached_count" bigint,
	"cached_is_exact" boolean,
	"cached_at" timestamp with time zone,
	"cached_duration_ms" integer,
	"recompute_state" text DEFAULT 'idle' NOT NULL,
	"last_error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_segments__name_len" CHECK (char_length("segments"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_segments__kind" CHECK ("segments"."kind" IN ('dynamic','static')),
	CONSTRAINT "ck_segments__recompute_state" CHECK ("segments"."recompute_state" IN ('idle','queued','running','error'))
);
--> statement-breakpoint
CREATE TABLE "subscription_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_ip" "inet",
	"request_ip" "inet",
	"request_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"fingerprint_key_id" smallint NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"removable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_note" text,
	CONSTRAINT "ck_suppressions__reason" CHECK ("suppressions"."reason" IN
    ('hard_bounce','soft_bounce_threshold','complaint','manual','global_unsubscribe',
     'one_click_unsubscribe','invalid','import','gdpr_erasure','ses_suppressed'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_tags__name_len" CHECK (char_length("tags"."name") BETWEEN 1 AND 60),
	CONSTRAINT "ck_tags__color" CHECK ("tags"."color" IS NULL OR "tags"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid,
	"campaign_id" uuid,
	"title" text,
	"credential_id" uuid,
	"model" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"finish_reason" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_messages__role" CHECK ("ai_messages"."role" IN ('system','user','assistant','tool'))
);
--> statement-breakpoint
CREATE TABLE "ai_provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"key_hint" text NOT NULL,
	"base_url" text,
	"default_model" text NOT NULL,
	"default_credential" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_provider_credentials__provider" CHECK ("ai_provider_credentials"."provider" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "ck_ai_provider_credentials__label_len" CHECK (length("ai_provider_credentials"."label") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "ai_usage_daily" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_ai_usage_daily" PRIMARY KEY("workspace_id","day","provider","model")
);
--> statement-breakpoint
CREATE TABLE "asset_references" (
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	CONSTRAINT "pk_asset_references" PRIMARY KEY("workspace_id","asset_id","ref_type","ref_id"),
	CONSTRAINT "ck_asset_references__ref_type" CHECK ("asset_references"."ref_type" ~ '^[a-z][a-z0-9_]{0,31}$')
);
--> statement-breakpoint
CREATE TABLE "asset_variants" (
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	CONSTRAINT "pk_asset_variants" PRIMARY KEY("workspace_id","asset_id","variant"),
	CONSTRAINT "ck_asset_variants__variant" CHECK ("asset_variants"."variant" ~ '^[a-z][a-z0-9_]{0,15}$')
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"sha256" "bytea" NOT NULL,
	"byte_size" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"frame_count" integer DEFAULT 1 NOT NULL,
	"original_filename" text NOT NULL,
	"alt_text" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"storage_key" text NOT NULL,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_assets__public_id" CHECK ("assets"."public_id" ~ '^[0-9A-Za-z]{22}$'),
	CONSTRAINT "ck_assets__sha256_len" CHECK (octet_length("assets"."sha256") = 32),
	CONSTRAINT "ck_assets__byte_size" CHECK ("assets"."byte_size" > 0),
	CONSTRAINT "ck_assets__source" CHECK ("assets"."source" IN ('upload','brand_extraction','seed','ai')),
	CONSTRAINT "ck_assets__reference_count" CHECK ("assets"."reference_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "brand_extractions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"input_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"hop_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bytes_fetched" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"result" jsonb,
	"brand_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_brand_extractions__status" CHECK ("brand_extractions"."status" IN
    ('pending','running','succeeded','failed','blocked'))
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_url" text,
	"logo_asset_id" uuid,
	"logo_dark_asset_id" uuid,
	"palette" jsonb NOT NULL,
	"typography" jsonb NOT NULL,
	"tone" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_profile" boolean DEFAULT false NOT NULL,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_snippets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"design" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"design" jsonb NOT NULL,
	"design_hash" "bytea" NOT NULL,
	"compiled_html" text,
	"compiled_text" text,
	"compile_meta" jsonb,
	"renderer_version" text,
	"label" text,
	"reason" text DEFAULT 'manual' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_template_versions__version" CHECK ("template_versions"."version" >= 1),
	CONSTRAINT "ck_template_versions__label_len" CHECK ("template_versions"."label" IS NULL OR length("template_versions"."label") <= 80),
	CONSTRAINT "ck_template_versions__reason" CHECK ("template_versions"."reason" IN
    ('manual','pre_send','ai_apply','restore','import'))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'campaign' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"design" jsonb NOT NULL,
	"design_hash" "bytea" NOT NULL,
	"current_version_id" uuid,
	"used_fields" text[] DEFAULT '{}' NOT NULL,
	"thumbnail_asset_id" uuid,
	"starter" boolean DEFAULT false NOT NULL,
	"validation_state" text DEFAULT 'unknown' NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_templates__name_len" CHECK (length("templates"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_templates__kind" CHECK ("templates"."kind" IN ('campaign','transactional','system')),
	CONSTRAINT "ck_templates__validation_state" CHECK ("templates"."validation_state" IN ('unknown','valid','invalid'))
);
--> statement-breakpoint
CREATE TABLE "campaign_audience_progress" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"phase" text DEFAULT 'collecting' NOT NULL,
	"cursor_contact_id" uuid,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"skipped_suppressed" integer DEFAULT 0 NOT NULL,
	"skipped_unsubscribed" integer DEFAULT 0 NOT NULL,
	"skipped_invalid" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_campaign_audience_progress__phase" CHECK ("campaign_audience_progress"."phase" IN ('collecting','materializing','done'))
);
--> statement-breakpoint
CREATE TABLE "campaign_content_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"label" text NOT NULL,
	"weight" smallint DEFAULT 1 NOT NULL,
	"subject" text,
	"preheader" text,
	"from_name" text,
	"design" jsonb,
	"compiled_html" text,
	"compiled_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_render_warnings" (
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code" text NOT NULL,
	"path" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sample" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "pk_campaign_render_warnings" PRIMARY KEY("workspace_id","campaign_id","code","path")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"reply_to" text,
	"template_id" uuid,
	"design" jsonb,
	"compiled_html" text,
	"compiled_text" text,
	"compiled_at" timestamp with time zone,
	"compiled_fields" text[] DEFAULT '{}' NOT NULL,
	"compiled_hash" text,
	"audience" jsonb DEFAULT '{"include":{"lists":[],"segments":[]},"exclude":{"lists":[],"segments":[]}}'::jsonb NOT NULL,
	"audience_size" integer,
	"audience_breakdown" jsonb,
	"audience_built_at" timestamp with time zone,
	"provider_id" uuid,
	"sender_domain_id" uuid,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL,
	"unsubscribe_list_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"release_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"schedule_timezone" text,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"complaint_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"pause_reason" jsonb,
	"cancel_reason" text,
	"last_error" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_campaigns__status" CHECK ("campaigns"."status" IN (
    'draft','scheduled','queueing','sending','paused',
    'sent','partially_sent','cancelled','failed','schedule_missed')),
	CONSTRAINT "ck_campaigns__schedule" CHECK (("campaigns"."status" <> 'scheduled') OR
    ("campaigns"."scheduled_at" IS NOT NULL AND "campaigns"."schedule_timezone" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "deliverability_snapshots" (
	"workspace_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"hard_bounces" integer DEFAULT 0 NOT NULL,
	"soft_bounces" integer DEFAULT 0 NOT NULL,
	"complaints" integer DEFAULT 0 NOT NULL,
	"rejects" integer DEFAULT 0 NOT NULL,
	"delivery_delays" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_deliverability_snapshots" PRIMARY KEY("workspace_id","provider_id","day")
);
--> statement-breakpoint
CREATE TABLE "sender_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"dkim_tokens" text[] DEFAULT '{}' NOT NULL,
	"dkim_hosted_zone" text,
	"dkim_key_length" text DEFAULT 'RSA_2048_BIT' NOT NULL,
	"dkim_status" text DEFAULT 'not_started' NOT NULL,
	"mail_from_subdomain" text,
	"mail_from_status" text DEFAULT 'not_configured' NOT NULL,
	"spf_ok" boolean,
	"dkim_ok" boolean,
	"dmarc_ok" boolean,
	"mx_ok" boolean,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"ses_verification_status" text,
	"verified_at" timestamp with time zone,
	"delegation_token_hash" text,
	"delegation_expires_at" timestamp with time zone,
	"delegation_created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sender_domains__dkim_status" CHECK ("sender_domains"."dkim_status" IN
    ('not_started','pending','success','failed','temporary_failure')),
	CONSTRAINT "ck_sender_domains__delegation" CHECK (
    ("sender_domains"."delegation_token_hash" IS NULL AND "sender_domains"."delegation_expires_at" IS NULL) OR
    ("sender_domains"."delegation_token_hash" IS NOT NULL AND "sender_domains"."delegation_expires_at" IS NOT NULL)),
	CONSTRAINT "ck_sender_domains__mail_from_status" CHECK ("sender_domains"."mail_from_status" IN
    ('not_configured','pending','success','failed'))
);
--> statement-breakpoint
CREATE TABLE "sending_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config_encrypted" text NOT NULL,
	"config_public" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"status_detail" jsonb,
	"verified_at" timestamp with time zone,
	"quota_max24h" integer,
	"quota_max_send_rate" numeric(10, 2),
	"quota_sent24h" integer,
	"production_access" boolean,
	"enforcement_status" text,
	"sending_enabled" boolean,
	"quota_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sending_providers__type" CHECK ("sending_providers"."type" IN ('ses','smtp')),
	CONSTRAINT "ck_sending_providers__status" CHECK ("sending_providers"."status" IN
    ('unverified','verifying','ready','degraded','blocked','disabled'))
);
--> statement-breakpoint
CREATE TABLE "campaign_link_stats" (
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"clicks_total" bigint DEFAULT 0 NOT NULL,
	"clicks_unique" bigint DEFAULT 0 NOT NULL,
	"clicks_human" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_campaign_link_stats" PRIMARY KEY("workspace_id","campaign_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_stats" (
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"materialized" bigint DEFAULT 0 NOT NULL,
	"sent" bigint DEFAULT 0 NOT NULL,
	"failed" bigint DEFAULT 0 NOT NULL,
	"skipped" bigint DEFAULT 0 NOT NULL,
	"delivered" bigint DEFAULT 0 NOT NULL,
	"bounced_hard" bigint DEFAULT 0 NOT NULL,
	"bounced_soft" bigint DEFAULT 0 NOT NULL,
	"complained" bigint DEFAULT 0 NOT NULL,
	"unsubscribed" bigint DEFAULT 0 NOT NULL,
	"opens_total" bigint DEFAULT 0 NOT NULL,
	"opens_unique" bigint DEFAULT 0 NOT NULL,
	"opens_unique_human" bigint DEFAULT 0 NOT NULL,
	"opens_unique_apple" bigint DEFAULT 0 NOT NULL,
	"clicks_total" bigint DEFAULT 0 NOT NULL,
	"clicks_unique" bigint DEFAULT 0 NOT NULL,
	"clicks_unique_human" bigint DEFAULT 0 NOT NULL,
	"clicks_scanner" bigint DEFAULT 0 NOT NULL,
	"first_event_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"progress_watermark_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_stats_buckets" (
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"opens_unique" integer DEFAULT 0 NOT NULL,
	"clicks_unique" integer DEFAULT 0 NOT NULL,
	"bounced" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_campaign_stats_buckets" PRIMARY KEY("workspace_id","campaign_id","bucket_at")
);
--> statement-breakpoint
CREATE TABLE "contact_engagement" (
	"contact_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_delivered_at" timestamp with time zone,
	"last_open_at" timestamp with time zone,
	"last_click_at" timestamp with time zone,
	"last_bounce_at" timestamp with time zone,
	"sent_total" integer DEFAULT 0 NOT NULL,
	"delivered_total" integer DEFAULT 0 NOT NULL,
	"opens_total" integer DEFAULT 0 NOT NULL,
	"clicks_total" integer DEFAULT 0 NOT NULL,
	"bounces_total" integer DEFAULT 0 NOT NULL,
	"sent7d" integer DEFAULT 0 NOT NULL,
	"sent30d" integer DEFAULT 0 NOT NULL,
	"sent90d" integer DEFAULT 0 NOT NULL,
	"opens7d" integer DEFAULT 0 NOT NULL,
	"opens30d" integer DEFAULT 0 NOT NULL,
	"opens90d" integer DEFAULT 0 NOT NULL,
	"clicks7d" integer DEFAULT 0 NOT NULL,
	"clicks30d" integer DEFAULT 0 NOT NULL,
	"clicks90d" integer DEFAULT 0 NOT NULL,
	"consecutive_no_open" integer DEFAULT 0 NOT NULL,
	"consecutive_no_click" integer DEFAULT 0 NOT NULL,
	"windows_recomputed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_contact_engagement" PRIMARY KEY("workspace_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"workspace_id" uuid NOT NULL,
	"anonymous_id" uuid NOT NULL,
	"contact_id" uuid,
	"bound_at" timestamp with time zone,
	"bind_count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_identities" PRIMARY KEY("workspace_id","anonymous_id")
);
--> statement-breakpoint
CREATE TABLE "identity_bindings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"anonymous_id" uuid NOT NULL,
	"contact_id" uuid,
	"valid_from" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_identity_bindings__source" CHECK ("identity_bindings"."source" IN
    ('email_click','sdk_identify','server_api','form','reset'))
);
--> statement-breakpoint
CREATE TABLE "identity_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"anonymous_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"events_total" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_identity_merges__status" CHECK ("identity_merges"."status" IN
    ('pending','running','completed','truncated','reverted','failed'))
);
--> statement-breakpoint
CREATE TABLE "identity_token_uses" (
	"nonce" "bytea" PRIMARY KEY NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_identity_token_uses__nonce_len" CHECK (octet_length("identity_token_uses"."nonce") = 8)
);
--> statement-breakpoint
CREATE TABLE "proxy_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"cidr" "cidr" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_proxy_ranges__provider" CHECK ("proxy_ranges"."provider" IN
    ('apple_private_relay','google','manual'))
);
--> statement-breakpoint
CREATE TABLE "tracking_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"host" text NOT NULL,
	"include_subdomains" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_tracking_domains__host" CHECK ("tracking_domains"."host" ~ '^[a-z0-9.-]{1,253}$')
);
--> statement-breakpoint
CREATE TABLE "web_event_months" (
	"workspace_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"month" date NOT NULL,
	CONSTRAINT "pk_web_event_months" PRIMARY KEY("workspace_id","subject_kind","subject_id","month"),
	CONSTRAINT "ck_web_event_months__kind" CHECK ("web_event_months"."subject_kind" IN ('contact','anonymous'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_scope_list_id_lists_id_fk" FOREIGN KEY ("scope_list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consent_state" ADD CONSTRAINT "contact_consent_state_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consent_state" ADD CONSTRAINT "contact_consent_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fields" ADD CONSTRAINT "contact_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_requests" ADD CONSTRAINT "gdpr_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_requests" ADD CONSTRAINT "gdpr_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_requests" ADD CONSTRAINT "gdpr_requests_export_id_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."exports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_resume_from_import_id_imports_id_fk" FOREIGN KEY ("resume_from_import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_dedup" ADD CONSTRAINT "inbound_dedup_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_dedup" ADD CONSTRAINT "inbound_dedup_endpoint_id_inbound_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."inbound_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_endpoints" ADD CONSTRAINT "inbound_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_subscriptions" ADD CONSTRAINT "list_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_subscriptions" ADD CONSTRAINT "list_subscriptions_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_subscriptions" ADD CONSTRAINT "list_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_overrides" ADD CONSTRAINT "name_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_policy_id_retention_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_confirmations" ADD CONSTRAINT "subscription_confirmations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_confirmations" ADD CONSTRAINT "subscription_confirmations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_confirmations" ADD CONSTRAINT "subscription_confirmations_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_credential_id_ai_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ai_provider_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_credentials" ADD CONSTRAINT "ai_provider_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_credentials" ADD CONSTRAINT "ai_provider_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "ai_usage_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_extractions" ADD CONSTRAINT "brand_extractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_extractions" ADD CONSTRAINT "brand_extractions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_extractions" ADD CONSTRAINT "brand_extractions_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_logo_dark_asset_id_assets_id_fk" FOREIGN KEY ("logo_dark_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_snippets" ADD CONSTRAINT "content_snippets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_thumbnail_asset_id_assets_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_progress" ADD CONSTRAINT "campaign_audience_progress_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_progress" ADD CONSTRAINT "campaign_audience_progress_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_variants" ADD CONSTRAINT "campaign_content_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_variants" ADD CONSTRAINT "campaign_content_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_render_warnings" ADD CONSTRAINT "campaign_render_warnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_render_warnings" ADD CONSTRAINT "campaign_render_warnings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_provider_id_sending_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sending_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_domain_id_sender_domains_id_fk" FOREIGN KEY ("sender_domain_id") REFERENCES "public"."sender_domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_unsubscribe_list_id_lists_id_fk" FOREIGN KEY ("unsubscribe_list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverability_snapshots" ADD CONSTRAINT "deliverability_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverability_snapshots" ADD CONSTRAINT "deliverability_snapshots_provider_id_sending_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sending_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_domains" ADD CONSTRAINT "sender_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_domains" ADD CONSTRAINT "sender_domains_provider_id_sending_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sending_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_domains" ADD CONSTRAINT "sender_domains_delegation_created_by_users_id_fk" FOREIGN KEY ("delegation_created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_providers" ADD CONSTRAINT "sending_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_engagement" ADD CONSTRAINT "contact_engagement_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_engagement" ADD CONSTRAINT "contact_engagement_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merges" ADD CONSTRAINT "identity_merges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merges" ADD CONSTRAINT "identity_merges_binding_id_identity_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."identity_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_domains" ADD CONSTRAINT "tracking_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_api_keys__prefix" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "idx_api_keys__workspace_id" ON "api_keys" USING btree ("workspace_id") WHERE "api_keys"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invitations__token_hash" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invitations__ws_email_pending" ON "invitations" USING btree ("workspace_id","email") WHERE "invitations"."accepted_at" IS NULL AND "invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_memberships__user_id" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_password_reset_tokens__token_hash" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_password_reset_tokens__user_id" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions__token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions__user_id" ON "sessions" USING btree ("user_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sessions__absolute_expires_at" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users__email" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces__slug" ON "workspaces" USING btree ("slug") WHERE "workspaces"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys__expires_at" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_rate_limits__expires" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_secret_key_generations__fingerprint" ON "secret_key_generations" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints__ws_active" ON "webhook_endpoints" USING btree ("workspace_id") WHERE "webhook_endpoints"."deleted_at" IS NULL AND "webhook_endpoints"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints__event_types" ON "webhook_endpoints" USING gin ("event_types");--> statement-breakpoint
CREATE INDEX "idx_consents__contact_purpose" ON "consents" USING btree ("contact_id","purpose","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_consents__ws_purpose" ON "consents" USING btree ("workspace_id","purpose","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_contact_consent_state__ws_purpose_status" ON "contact_consent_state" USING btree ("workspace_id","purpose","status","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contact_fields__workspace_key" ON "contact_fields" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "idx_contact_fields__ws_position" ON "contact_fields" USING btree ("workspace_id","position") WHERE "contact_fields"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contact_tags__ws_tag_contact" ON "contact_tags" USING btree ("workspace_id","tag_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contacts__workspace_email" ON "contacts" USING btree ("workspace_id","email") WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_created" ON "contacts" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_status_created" ON "contacts" USING btree ("workspace_id","status","created_at" DESC NULLS LAST) WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_last_activity" ON "contacts" USING btree ("workspace_id","last_activity_at" DESC NULLS LAST) WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__search_trgm" ON "contacts" USING gin ("workspace_id","search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_contacts__search_key_trgm" ON "contacts" USING gin ("workspace_id","search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_contacts__attributes_gin" ON "contacts" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_vocative_review" ON "contacts" USING btree ("workspace_id","first_name_key","created_at" DESC NULLS LAST) WHERE "contacts"."vocative_confidence" = 'low' AND "contacts"."vocative_locked" = false
               AND "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_email_domain" ON "contacts" USING btree ("workspace_id","email_domain") WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts__email_fingerprints" ON "contacts" USING gin ("email_fingerprints");--> statement-breakpoint
CREATE INDEX "idx_contacts__ws_id" ON "contacts" USING btree ("workspace_id","id") WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contacts__ws_external_id" ON "contacts" USING btree ("workspace_id","external_id") WHERE "contacts"."external_id" IS NOT NULL AND "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_exports__ws_created" ON "exports" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_exports__download_token" ON "exports" USING btree ("download_token_hash") WHERE "exports"."download_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_exports__expiry" ON "exports" USING btree ("expires_at") WHERE "exports"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "idx_form_submissions__form_created" ON "form_submissions" USING btree ("form_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_form_submissions__ws_created" ON "form_submissions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forms__slug" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_forms__ws_created" ON "forms" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_gdpr_requests__ws_due" ON "gdpr_requests" USING btree ("workspace_id","due_at") WHERE "gdpr_requests"."status" IN ('received','verifying','processing');--> statement-breakpoint
CREATE INDEX "idx_gdpr_requests__ws_created" ON "gdpr_requests" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_gdpr_requests__ws_fingerprint" ON "gdpr_requests" USING btree ("workspace_id","subject_email_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_import_errors__ws_import_row" ON "import_errors" USING btree ("workspace_id","import_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_imports__workspace_idempotency" ON "imports" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_imports__ws_created" ON "imports" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_imports__file_expiry" ON "imports" USING btree ("file_expires_at") WHERE "imports"."storage_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_imports__stale" ON "imports" USING btree ("updated_at") WHERE "imports"."status" = 'importing';--> statement-breakpoint
CREATE INDEX "idx_inbound_dedup__created" ON "inbound_dedup" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inbound_endpoints__slug" ON "inbound_endpoints" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_inbound_endpoints__ws_created" ON "inbound_endpoints" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_list_subscriptions__list_status" ON "list_subscriptions" USING btree ("list_id","status","contact_id");--> statement-breakpoint
CREATE INDEX "idx_list_subscriptions__pending" ON "list_subscriptions" USING btree ("workspace_id","confirmation_sent_at") WHERE "list_subscriptions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_list_subscriptions__snooze" ON "list_subscriptions" USING btree ("workspace_id","snooze_until") WHERE "list_subscriptions"."snooze_until" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lists__workspace_name" ON "lists" USING btree ("workspace_id",lower("name")) WHERE "lists"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lists__workspace_default" ON "lists" USING btree ("workspace_id") WHERE "lists"."is_default" AND "lists"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_name_overrides__ws_kind_key" ON "name_overrides" USING btree ("workspace_id","kind","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_retention_policies__workspace_target" ON "retention_policies" USING btree ("workspace_id","target");--> statement-breakpoint
CREATE INDEX "idx_retention_runs__ws_started" ON "retention_runs" USING btree ("workspace_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_segment_members__ws_contact" ON "segment_members" USING btree ("workspace_id","contact_id","segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_segments__workspace_name" ON "segments" USING btree ("workspace_id",lower("name")) WHERE "segments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_segments__stale" ON "segments" USING btree ("cached_at" NULLS FIRST) WHERE "segments"."deleted_at" IS NULL AND "segments"."kind" = 'dynamic';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_confirmations__token_hash" ON "subscription_confirmations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_subscription_confirmations__expiry" ON "subscription_confirmations" USING btree ("expires_at") WHERE "subscription_confirmations"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_subscription_confirmations__ws_created" ON "subscription_confirmations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_suppressions__workspace_email" ON "suppressions" USING btree ("workspace_id","email") WHERE "suppressions"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_suppressions__ws_fingerprint" ON "suppressions" USING btree ("workspace_id","fingerprint") WHERE "suppressions"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_suppressions__fingerprint_key_id" ON "suppressions" USING btree ("fingerprint_key_id");--> statement-breakpoint
CREATE INDEX "idx_suppressions__ws_reason" ON "suppressions" USING btree ("workspace_id","reason","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tags__workspace_name" ON "tags" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "idx_ai_conversations__template_created" ON "ai_conversations" USING btree ("template_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_ai_conversations__ws_updated" ON "ai_conversations" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_messages__ws_conversation_seq" ON "ai_messages" USING btree ("workspace_id","conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_provider_credentials__workspace_label" ON "ai_provider_credentials" USING btree ("workspace_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_provider_credentials__workspace_default" ON "ai_provider_credentials" USING btree ("workspace_id") WHERE "ai_provider_credentials"."default_credential";--> statement-breakpoint
CREATE INDEX "idx_asset_references__ref" ON "asset_references" USING btree ("workspace_id","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_assets__workspace_sha256" ON "assets" USING btree ("workspace_id","sha256") WHERE "assets"."purged_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_assets__public_id" ON "assets" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_assets__workspace_created" ON "assets" USING btree ("workspace_id","created_at" DESC NULLS LAST) WHERE "assets"."hidden_at" IS NULL AND "assets"."purged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_brand_extractions__workspace_created" ON "brand_extractions" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brand_profiles__workspace_default" ON "brand_profiles" USING btree ("workspace_id") WHERE "brand_profiles"."default_profile";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_content_snippets__workspace_name" ON "content_snippets" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_template_versions__template_version" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "idx_template_versions__template_created" ON "template_versions" USING btree ("template_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_template_versions__cleanup" ON "template_versions" USING btree ("workspace_id","created_at") WHERE "template_versions"."pinned" = false;--> statement-breakpoint
CREATE INDEX "idx_templates__workspace_updated" ON "templates" USING btree ("workspace_id","updated_at" DESC NULLS LAST) WHERE "templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_templates__workspace_name" ON "templates" USING btree ("workspace_id",lower("name")) WHERE "templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_templates__invalid" ON "templates" USING btree ("workspace_id") WHERE "templates"."validation_state" = 'invalid' AND "templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_templates__used_fields" ON "templates" USING gin ("used_fields");--> statement-breakpoint
CREATE INDEX "idx_campaign_audience_progress__ws_updated" ON "campaign_audience_progress" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_content_variants__ws_campaign_label" ON "campaign_content_variants" USING btree ("workspace_id","campaign_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_links__ws_campaign_position" ON "campaign_links" USING btree ("workspace_id","campaign_id","position");--> statement-breakpoint
CREATE INDEX "idx_campaigns__workspace_status" ON "campaigns" USING btree ("workspace_id","status","updated_at" DESC NULLS LAST) WHERE "campaigns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_campaigns__scheduler" ON "campaigns" USING btree ("scheduled_at") WHERE "campaigns"."status" = 'scheduled' AND "campaigns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_campaigns__running" ON "campaigns" USING btree ("workspace_id") WHERE "campaigns"."status" IN ('queueing','sending') AND "campaigns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sender_domains__workspace_domain" ON "sender_domains" USING btree ("workspace_id",lower("domain"));--> statement-breakpoint
CREATE INDEX "idx_sender_domains__next_check" ON "sender_domains" USING btree ("next_check_at") WHERE "sender_domains"."next_check_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sender_domains__delegation_token" ON "sender_domains" USING btree ("delegation_token_hash") WHERE "sender_domains"."delegation_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sending_providers__one_default" ON "sending_providers" USING btree ("workspace_id") WHERE "sending_providers"."is_default";--> statement-breakpoint
CREATE INDEX "idx_sending_providers__workspace" ON "sending_providers" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sending_providers__quota_stale" ON "sending_providers" USING btree ("quota_checked_at" NULLS FIRST) WHERE "sending_providers"."status" IN ('ready','degraded');--> statement-breakpoint
CREATE INDEX "idx_campaign_stats__workspace" ON "campaign_stats" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_contact_engagement__ws_last_open" ON "contact_engagement" USING btree ("workspace_id","last_open_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_contact_engagement__ws_no_open" ON "contact_engagement" USING btree ("workspace_id","consecutive_no_open" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_contact_engagement__ws_last_click" ON "contact_engagement" USING btree ("workspace_id","last_click_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_contact_engagement__stale_windows" ON "contact_engagement" USING btree ("windows_recomputed_at") WHERE "contact_engagement"."sent90d" > 0 OR "contact_engagement"."opens90d" > 0 OR "contact_engagement"."clicks90d" > 0;--> statement-breakpoint
CREATE INDEX "idx_identities__contact" ON "identities" USING btree ("workspace_id","contact_id") WHERE "identities"."contact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_identity_bindings__lookup" ON "identity_bindings" USING btree ("workspace_id","anonymous_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_identity_merges__contact" ON "identity_merges" USING btree ("workspace_id","contact_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_identity_token_uses__expiry" ON "identity_token_uses" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_proxy_ranges__provider" ON "proxy_ranges" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_proxy_ranges__cidr" ON "proxy_ranges" USING gist ("cidr" inet_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tracking_domains__workspace_host" ON "tracking_domains" USING btree ("workspace_id","host");