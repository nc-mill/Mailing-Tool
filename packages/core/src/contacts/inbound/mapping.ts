import { readPath } from './path';

export type Transform =
  'lowercase' | 'uppercase' | 'trim' | 'language_tag' | 'unix_seconds' | 'unix_millis' | 'boolean';

const TRUE_VALUES = new Set(['1', 'true', 'ano', 'yes', 'y', 'a', 'x', 'on']);

/** Povolené transformace. Uzavřený seznam, nic mimo něj se nedá zavolat. */
export function applyTransform(value: unknown, transform: Transform): unknown {
  if (value === null || value === undefined) return null;
  switch (transform) {
    case 'lowercase':
      return String(value).toLowerCase();
    case 'uppercase':
      return String(value).toUpperCase();
    case 'trim':
      return String(value).trim();
    // Z cs-CZ udělá cs, aby se sloupec locale plnil konzistentně.
    case 'language_tag':
      return (String(value).split('-')[0] ?? '').toLowerCase();
    case 'unix_seconds':
      return new Date(Number(value) * 1000).toISOString();
    case 'unix_millis':
      return new Date(Number(value)).toISOString();
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      return TRUE_VALUES.has(String(value).trim().toLowerCase());
    }
    default:
      return value;
  }
}

export type InboundAction = 'subscribe' | 'unsubscribe' | 'update' | 'ignore';

/** Pravidlo pro jedno pole. Deklarativní, bez spustitelného obsahu. */
export type FieldRule = {
  path: string;
  required?: boolean;
  transform?: Transform;
  type?: 'number' | 'datetime' | 'text' | 'boolean';
};

/**
 * Mapování je JSON z databáze, tedy hodnota, kterou zadal uživatel nástroje. Typ je proto
 * psaný obranně: každá větev je volitelná a chybějící část znamená výchozí chování,
 * ne výjimku uprostřed zpracování dávky.
 */
export type InboundMapping = {
  version?: number;
  event?: { path: string; map?: Record<string, string>; default?: string };
  external_id?: { path: string };
  contact?: {
    email?: FieldRule;
    attributes?: Record<string, FieldRule>;
  } & Record<string, FieldRule | Record<string, FieldRule> | undefined>;
  lists?: string[];
  tags?: string[];
  consent?: {
    purpose: string;
    legal_basis: string;
    consent_text?: string;
    when?: { path: string; equals: unknown };
  };
  on_conflict?: string;
};

export type MappedDelivery = {
  action: InboundAction;
  externalId: string | null;
  contact: { email: string; attributes: Record<string, unknown> } & Record<string, unknown>;
  listIds: string[];
  tags: string[];
  consent?: { purpose: string; legalBasis: string; consentText?: string };
  onConflict: string;
};

export type MappingResult =
  | ({ ok: true } & MappedDelivery)
  | { ok: false; code: 'mapping_required_missing' | 'mapping_invalid'; path?: string };

const ACTIONS = new Set<InboundAction>(['subscribe', 'unsubscribe', 'update', 'ignore']);

function asAction(value: unknown): InboundAction {
  return ACTIONS.has(value as InboundAction) ? (value as InboundAction) : 'ignore';
}

/**
 * Aplikuje deklarativní mapování na payload. Bez psaní kódu, bez spustitelných výrazů.
 *
 * Doručení, které projde podpisem, ale nedá se namapovat, se NEZTRATÍ: uloží se
 * se stavem unmapped a s celým payloadem, aby ho uživatel mohl v průvodci namapovat
 * kliknutím na skutečnou hodnotu. Tvar payloadu se nehádá podle dokumentace e-shopu,
 * přijme se skutečný a ukáže se na něj prstem.
 */
export function applyMapping(payload: unknown, mapping: InboundMapping): MappingResult {
  const eventPath = mapping.event?.path;
  const eventValue = eventPath === undefined ? null : readPath(payload, eventPath);
  const action = asAction(
    mapping.event?.map?.[String(eventValue)] ?? mapping.event?.default ?? 'ignore',
  );

  const contact: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(mapping.contact ?? {})) {
    if (field === 'attributes' || spec === undefined) continue;
    const rule = spec as FieldRule;
    if (typeof rule.path !== 'string') continue;
    let value = readPath(payload, rule.path);
    if (rule.transform !== undefined) value = applyTransform(value, rule.transform);
    if ((value === null || value === '') && rule.required === true) {
      return { ok: false, code: 'mapping_required_missing', path: rule.path };
    }
    if (value !== null) contact[field] = value;
  }

  const attributes: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(mapping.contact?.attributes ?? {})) {
    const rule = spec;
    let value = readPath(payload, rule.path);
    if (rule.transform !== undefined) value = applyTransform(value, rule.transform);
    if (value === null) continue;
    if (rule.type === 'number') value = Number(value);
    if (rule.type === 'datetime' && typeof value === 'number') {
      value = applyTransform(value, 'unix_seconds');
    }
    attributes[key] = value;
  }
  contact['attributes'] = attributes;

  if (typeof contact['email'] !== 'string' || contact['email'] === '') {
    const path = mapping.contact?.email?.path;
    return path === undefined
      ? { ok: false, code: 'mapping_required_missing' }
      : { ok: false, code: 'mapping_required_missing', path };
  }

  let consent: MappedDelivery['consent'];
  const consentSpec = mapping.consent;
  if (consentSpec !== undefined) {
    const when = consentSpec.when;
    const matches = when === undefined || readPath(payload, when.path) === when.equals;
    if (matches) {
      consent =
        consentSpec.consent_text === undefined
          ? { purpose: consentSpec.purpose, legalBasis: consentSpec.legal_basis }
          : {
              purpose: consentSpec.purpose,
              legalBasis: consentSpec.legal_basis,
              consentText: consentSpec.consent_text,
            };
    }
  }

  const externalId =
    mapping.external_id === undefined
      ? null
      : ((readPath(payload, mapping.external_id.path) as string | null) ?? null);

  const mapped: MappedDelivery = {
    action,
    externalId,
    contact: contact as MappedDelivery['contact'],
    listIds: mapping.lists ?? [],
    tags: mapping.tags ?? [],
    onConflict: mapping.on_conflict ?? 'update',
  };
  // `exactOptionalPropertyTypes` nedovolí přiřadit undefined do volitelného pole,
  // takže se klíč buď doplní, nebo se nezaloží vůbec.
  if (consent !== undefined) mapped.consent = consent;

  return { ok: true, ...mapped };
}
