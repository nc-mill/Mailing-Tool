/**
 * Kontrakt 1: outbox protokol.
 * Zdroj: část 1, kapitola 4.10.1. ZMRAZENO. Změna znamená verzi v2, ne úpravu v1.
 */

export const MESSAGE_STATUSES = ['pending', 'claimed', 'sent', 'failed', 'skipped'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Druh zprávy v outboxu.
 *
 * `campaign` a `test` jsou původní zmrazená dvojice. `transactional` (volání
 * API zákazníka) a `automation` (uzel automatizace, plán P17) se přidávají
 * ROZŠÍŘENÍM výčtu, ne změnou významu stávajících hodnot: obě práce sahaly
 * do téhož CHECKu a do téže claim smyčky, takže se to dělá jednou.
 */
export const MESSAGE_KINDS = ['campaign', 'test', 'transactional', 'automation'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Druhy, které NEPATŘÍ kampani. Claim smyčka je bere vlastní, krátkou větví,
 * protože kampaňová větev dojíždí celou rozesílku, než se vrátí, a reset hesla
 * by čekal desítky minut.
 */
export const NON_CAMPAIGN_MESSAGE_KINDS = ['test', 'transactional', 'automation'] as const;

/**
 * Druhy, které NESMÍ nést odhlašovací odkaz ani hlavičku `List-Unsubscribe`.
 * Transakční zpráva je plnění smlouvy, ne marketing, a odhlašovat reset hesla
 * nedává smysl.
 */
export const NO_UNSUBSCRIBE_MESSAGE_KINDS = ['transactional'] as const;

export const TERMINAL_STATUSES = ['sent', 'failed', 'skipped'] as const;

/** Kdo přechod provádí. `reaper` běží uvnitř senderu, ale nekontroluje `claimed_by`. */
export type TransitionActor = 'app' | 'sender' | 'reaper';

export type TransitionInput = {
  from: MessageStatus;
  to: MessageStatus;
  actor: TransitionActor;
  /**
   * hodnota `messages.error_code` na řádku PŘED přechodem
   *
   * `undefined` je v typu schválně: preset tsconfigu zapíná `exactOptionalPropertyTypes`,
   * takže bez něj by volající nesměl klíč předat s hodnotou `undefined`, přestože ho
   * `canTransition` i `OutboxTransitionError` ("neuvedeno") takhle čekají.
   */
  errorCode?: string | null | undefined;
};

type Rule = { from: MessageStatus; to: MessageStatus; actors: readonly TransitionActor[] };

const RULES: readonly Rule[] = [
  { from: 'pending', to: 'claimed', actors: ['sender'] },
  { from: 'pending', to: 'skipped', actors: ['app'] },
  { from: 'claimed', to: 'sent', actors: ['sender'] },
  { from: 'claimed', to: 'failed', actors: ['sender'] },
  { from: 'claimed', to: 'pending', actors: ['sender', 'reaper'] },
  { from: 'claimed', to: 'skipped', actors: ['sender'] },
];

/**
 * Jediná výjimka ze zákazu `failed -> sent`.
 *
 * Přechod je povolený výhradně tehdy, když má zpráva `error_code = 'ambiguous_dispatch'`
 * a provádí ho APLIKACE při zpracování události od providera. Sender výjimku nemá.
 * Vázanost na jednu hodnotu v jednom sloupci dělá výjimku auditovatelnou.
 */
export const AMBIGUOUS_DISPATCH_ERROR_CODE = 'ambiguous_dispatch';

export function canTransition(input: TransitionInput): boolean {
  if (
    input.from === 'failed' &&
    input.to === 'sent' &&
    input.actor === 'app' &&
    input.errorCode === AMBIGUOUS_DISPATCH_ERROR_CODE
  ) {
    return true;
  }
  return RULES.some(
    (rule) => rule.from === input.from && rule.to === input.to && rule.actors.includes(input.actor),
  );
}

export class OutboxTransitionError extends Error {
  constructor(readonly input: TransitionInput) {
    super(
      `zakázaný přechod messages.status: ${input.from} -> ${input.to} (aktér ${input.actor}` +
        `, error_code ${input.errorCode === undefined ? 'neuvedeno' : String(input.errorCode)})`,
    );
    this.name = 'OutboxTransitionError';
  }
}

export function assertTransition(input: TransitionInput): void {
  if (!canTransition(input)) throw new OutboxTransitionError(input);
}

/**
 * Kontraktní sloupce tabulky messages. Část 4 smí přidávat sloupce a indexy,
 * nesmí měnit název, typ ani sémantiku těchto.
 *
 * Typy jsou hodnoty `information_schema.columns.data_type`, protože proti tomu
 * porovnává job contracts-schema.
 */
export const MESSAGES_CONTRACT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  id: 'uuid',
  workspace_id: 'uuid',
  campaign_id: 'uuid',
  content_variant_id: 'uuid',
  kind: 'text',
  contact_id: 'uuid',
  email: 'text',
  render_data: 'jsonb',
  status: 'text',
  claimed_by: 'text',
  claimed_at: 'timestamp with time zone',
  claim_expires_at: 'timestamp with time zone',
  attempts: 'smallint',
  ambiguous_count: 'smallint',
  dispatch_started_at: 'timestamp with time zone',
  next_attempt_at: 'timestamp with time zone',
  provider_message_id: 'text',
  sent_at: 'timestamp with time zone',
  error_code: 'text',
  error_detail: 'text',
  created_at: 'timestamp with time zone',
  updated_at: 'timestamp with time zone',
});

/** Sloupce, na které má sender `UPDATE` grant. `created_at` mezi nimi SCHVÁLNĚ není. */
export const MESSAGES_SENDER_UPDATABLE_COLUMNS = [
  'status',
  'claimed_by',
  'claimed_at',
  'claim_expires_at',
  'dispatch_started_at',
  'attempts',
  'next_attempt_at',
  'provider_message_id',
  'sent_at',
  'error_code',
  'error_detail',
  'ambiguous_count',
  'updated_at',
] as const;

/** Kontraktní sloupce cizích tabulek, které sender čte nebo zapisuje (4.10.1). */
export const FOREIGN_CONTRACT_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  campaigns: [
    'id',
    'workspace_id',
    'status',
    'pause_reason',
    'scheduled_at',
    'audience_built_at',
    'provider_id',
    'compiled_html',
    'compiled_text',
    'subject',
    'preheader',
    'from_name',
    'from_email',
    'reply_to',
    'track_opens',
    'track_clicks',
    'deleted_at',
  ],
  sending_providers: [
    'id',
    'workspace_id',
    'type',
    'config_encrypted',
    'quota_max_send_rate',
    'verified_at',
  ],
  campaign_links: ['id', 'campaign_id', 'url', 'position'],
  workspaces: ['id', 'deleted_at'],
  suppressions: [
    'workspace_id',
    'email',
    'fingerprint',
    'fingerprint_key_id',
    // `reason` čte sender kvůli transakční poště: odhlášení z marketingu ji
    // blokovat nesmí, tvrdý odraz a výmaz podle GDPR ano. Grant se tím nemění,
    // sender má SELECT na celou tabulku.
    'reason',
    'removed_at',
    'created_at',
  ],
  message_events: [
    'id',
    'message_id',
    'message_created_at',
    'workspace_id',
    'type',
    'ts',
    'received_at',
    'source',
    'metadata',
  ],
});

/** Výchozí hodnoty parametrů claimu podle 4.9. Sender je čte z prostředí. */
export const CLAIM_DEFAULTS = Object.freeze({
  batchSize: 100,
  claimTtlSeconds: 300,
  pollIntervalMs: 1000,
});
