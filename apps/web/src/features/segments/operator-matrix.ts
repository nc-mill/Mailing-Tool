/**
 * Typová matice pole × operátor jako ČISTÁ DATA.
 *
 * Proč kopie a ne import z `@mlain/core/segments`: ten balíček reexportuje
 * i `repo`, `service` a `sql-runner`, takže s sebou táhne `@mlain/db`. Import
 * z komponenty (klientské i serverové) tím vtáhne do sestavení celý přístup
 * k databázi včetně `migrate.ts`, který Turbopack neumí staticky přeložit,
 * a stránka skončí na 500. Ověřeno spuštěním, obojím směrem.
 *
 * Rozejití hlídá test `apps/web/test/segments/matrix-parity.test.ts`: běží
 * v Node, kde import jádra vadí, a porovnává OBĚ strany klíč po klíči. Kdyby
 * kompilátor operátor přidal, přesunul nebo odebral, spadne to tam, ne až
 * na obrazovce vstupem, který server odmítne.
 */
export type FieldClass =
  | 'text'
  | 'long_text'
  | 'url'
  | 'email'
  | 'phone'
  | 'email_domain'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multi_enum'
  | 'tag'
  | 'list'
  | 'consent'
  | 'suppression'
  | 'engagement'
  | 'event'
  | 'segment';

const TEXT_OPS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
];

const TEMPORAL_OPS = [
  'on',
  'before',
  'after',
  'between',
  'in_last_days',
  'not_in_last_days',
  'in_next_days',
  'is_empty',
  'is_not_empty',
];

export const FIELD_CLASS_OPERATORS: Record<FieldClass, string[]> = {
  text: TEXT_OPS,
  long_text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  email_domain: TEXT_OPS,
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false', 'is_empty'],
  date: TEMPORAL_OPS,
  datetime: TEMPORAL_OPS,
  enum: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi_enum: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  tag: ['has_any', 'has_all', 'has_none'],
  list: ['is_member', 'is_not_member', 'is_confirmed', 'is_pending', 'is_unsubscribed'],
  consent: ['is_granted', 'is_withdrawn', 'is_missing'],
  suppression: ['is_suppressed', 'is_not_suppressed'],
  engagement: ['did', 'did_not', 'count_gte', 'count_lte'],
  event: ['did', 'did_not', 'count_gte', 'count_lte'],
  segment: ['in', 'not_in'],
};

export const CONTACT_FIELD_CLASS: Record<string, FieldClass> = {
  email: 'email',
  email_domain: 'email_domain',
  first_name: 'text',
  last_name: 'text',
  gender: 'enum',
  status: 'enum',
  locale: 'enum',
  source: 'enum',
  created_at: 'datetime',
  updated_at: 'datetime',
  last_activity_at: 'datetime',
  vocative_confidence: 'enum',
  processing_restricted: 'boolean',
};

export const CONTACT_FIELD_KEYS = Object.keys(CONTACT_FIELD_CLASS);

export const CONSENT_PURPOSES = [
  'email_marketing',
  'analytics',
  'personalization',
  'profiling',
  'third_party',
];

export const ENGAGEMENT_METRICS = ['sent', 'delivered', 'opened', 'clicked', 'bounced'];

export function contactFieldClass(key: string): FieldClass {
  return CONTACT_FIELD_CLASS[key] ?? 'text';
}
