import type { ContactFieldKey } from '../ast';

/**
 * Překlad klíče na sloupec jde přes tuhle mapu a nikdy konkatenací.
 * Klíč, který v mapě není, nemůže vyrobit SQL. Zástupný znak `{a}` se
 * nahradí aliasem, aby si volající mohl zvolit vlastní.
 */
const TEMPLATES: Record<ContactFieldKey, string> = {
  email: '{a}.email::text',
  email_domain: '{a}.email_domain',
  first_name: '{a}.first_name',
  last_name: '{a}.last_name',
  gender: '{a}.gender',
  status: '{a}.status',
  locale: '{a}.locale',
  source: '{a}.source',
  created_at: '{a}.created_at',
  updated_at: '{a}.updated_at',
  last_activity_at: '{a}.last_activity_at',
  vocative_confidence: '{a}.vocative_confidence',
  processing_restricted: '{a}.processing_restricted',
};

export const CONTACT_COLUMN_SQL: Readonly<Record<ContactFieldKey, string>> = TEMPLATES;

export const ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,9}$/;

export function assertAlias(alias: string): void {
  if (!ALIAS_PATTERN.test(alias)) throw new Error(`invalid alias: ${alias}`);
}

export function contactColumnSql(alias: string, key: ContactFieldKey): string {
  assertAlias(alias);
  const template = TEMPLATES[key];
  if (!template) throw new Error(`unknown contact field: ${key}`);
  return template.replace('{a}', alias);
}
