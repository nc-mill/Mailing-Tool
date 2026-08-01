/** Pevná sada podle 4.7 části 2. Názvy sloupců běžného exportu se překládají. */
export const FIXED_EXPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'first_name_vocative',
  'greeting',
  'status',
  'locale',
  'source',
  'created_at',
  'last_activity_at',
] as const;

export type FixedColumn = (typeof FIXED_EXPORT_COLUMNS)[number];

export const COLUMN_SQL: Record<FixedColumn, string> = {
  email: 'c.email::text',
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  title_prefix: 'c.title_prefix',
  title_suffix: 'c.title_suffix',
  gender: 'c.gender',
  first_name_vocative: 'c.first_name_vocative',
  greeting: 'c.greeting',
  status: 'c.status',
  locale: 'c.locale',
  source: 'c.source',
  created_at: `to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')`,
  last_activity_at: `to_char(c.last_activity_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')`,
};

export function isFixedColumn(value: string): value is FixedColumn {
  return (FIXED_EXPORT_COLUMNS as readonly string[]).includes(value);
}

export function attributeColumnSql(paramRef: string): string {
  return `c.attributes ->> ${paramRef}`;
}

/** Štítky spojené svislítkem, aby se daly nahrát zpátky importem. */
export const TAGS_COLUMN_SQL = `(SELECT string_agg(t.name, '|' ORDER BY t.name) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id)`;

export function listStatusColumnSql(paramRef: string): string {
  return `(SELECT ls.status FROM list_subscriptions ls WHERE ls.contact_id = c.id AND ls.list_id = ${paramRef})`;
}
