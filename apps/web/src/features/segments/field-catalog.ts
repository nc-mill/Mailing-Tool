import {
  CONSENT_PURPOSES,
  CONTACT_FIELD_KEYS,
  contactFieldClass,
  ENGAGEMENT_METRICS,
  FIELD_CLASS_OPERATORS,
  type FieldClass,
} from './operator-matrix';
import { fieldRefKey, OPERATOR_SHAPES } from '@mlain/ui/patterns/query-builder';
import type {
  FieldDefinition,
  FieldValueType,
  OperatorDefinition,
  OperatorValueShape,
} from '@mlain/ui/patterns/query-builder';
import type { Translate } from './labels';
import { isNegating } from './negating-operators';

/**
 * Katalog polí pro K2.
 *
 * Matice se čte z `./operator-matrix`, ne z `@mlain/core/segments`: jádro
 * s sebou táhne `@mlain/db` a sestavení stránky na tom padá. Shodu obou
 * seznamů hlídá `test/segments/matrix-parity.test.ts`.
 *
 * Bez něj má podmínka prázdnou nabídku pole a builder nejde použít vůbec.
 * Odhalilo to teprve proklikání v prohlížeči: strom se vykreslil, tlačítka
 * fungovala a jediné, co chybělo, byla data.
 *
 * `ref` musí být DOSLOVA tvar, který jde do AST: komponenta pole poznává
 * porovnáním `ref` s `condition.field`, ne podle `id`.
 */
const SHAPE_BY_OPERATOR = new Map<string, OperatorValueShape>(
  Object.entries(OPERATOR_SHAPES).flatMap(([shape, list]) =>
    list.map((operator) => [operator, shape as OperatorValueShape] as const),
  ),
);

const VALUE_TYPE_BY_CLASS: Record<string, FieldValueType> = {
  text: 'text',
  long_text: 'text',
  url: 'text',
  email: 'text',
  phone: 'text',
  email_domain: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  enum: 'enum',
  multi_enum: 'enum',
};

/**
 * Odkaz na jiný segment nese `segment_id` v POLI, ne v hodnotě, takže tvar
 * `in` a `not_in` je tady `none`.
 *
 * Obecná tabulka tvarů řadí `in` mezi seznamové, a stavitel proto u podmínky
 * „je v segmentu" nabízel výčet hodnot, který kompilátor beze zbytku ignoruje.
 * Prázdný výčet přitom server odmítl (`in requires values`), takže se podmínka
 * dala uložit jedině s vymyšlenou hodnotou. Ověřeno voláním:
 * `POST /api/v1/segments/preview` → 422 `segment_invalid_ast`, „in requires
 * values". Druhou polovinu, tedy že hodnota chybět SMÍ, řeší jádro
 * v `assertValueShape`.
 */
const SHAPE_OVERRIDES: Partial<Record<FieldClass, Record<string, OperatorValueShape>>> = {
  segment: { in: 'none', not_in: 'none' },
};

function operatorsFor(fieldClass: FieldClass, t: Translate): OperatorDefinition[] {
  const overrides = SHAPE_OVERRIDES[fieldClass];
  return FIELD_CLASS_OPERATORS[fieldClass].map((operator) => ({
    id: operator,
    label: t(`operators.${operator}`),
    shape: overrides?.[operator] ?? SHAPE_BY_OPERATOR.get(operator) ?? 'scalar',
    ...(isNegating(operator) ? { negating: true } : {}),
  }));
}

/**
 * Uzavřené číselníky kontaktu. Bez nich se stav, pohlaví ani zdroj nedaly
 * zadat jinak než opsáním anglického kódu z databáze; překlep skončil segmentem
 * s nulou lidí a bez jediného náznaku proč.
 *
 * `locale` tu schválně NENÍ: je to otevřená množina hlídaná jen tvarem
 * (`ck_contacts__locale`), takže výběr by uživateli bral hodnoty, které jsou
 * platné. `status` je bez hodnoty `deleted`, protože obálka dotazu smazané
 * kontakty vyřazuje vždycky a taková podmínka by vracela nulu pokaždé.
 */
const CONTACT_ENUM_VALUES: Record<string, string[]> = {
  status: ['active', 'unconfirmed', 'unsubscribed', 'bounced', 'complained'],
  gender: ['female', 'male', 'unknown'],
  source: ['manual', 'import', 'api', 'form', 'webhook', 'double_opt_in', 'migration'],
  vocative_confidence: ['high', 'low', 'none'],
};

function contactEnumOptions(
  key: string,
  t: Translate,
): { options: Array<{ value: string; label: string }> } | Record<string, never> {
  const values = CONTACT_ENUM_VALUES[key];
  if (values === undefined) return {};
  return { options: values.map((value) => ({ value, label: t(`fieldValues.${key}.${value}`) })) };
}

export type CatalogInput = {
  attributes?: { key: string; label: string; fieldClass: FieldClass }[];
  lists?: { id: string; name: string }[];
  segments?: { id: string; name: string }[];
  /**
   * Štítky projektu. Podmínka na štítek se ukládá jako IDENTIFIKÁTOR, takže
   * bez tohohle seznamu neměl stavitel co nabídnout a zbýval volný text, ze
   * kterého vznikl dotaz s neplatným uuid a pětistovka. Viz `ValueList`.
   */
  tags?: { id: string; name: string }[];
  /**
   * Definice, která se právě otevírá.
   *
   * Slouží k jedinému: doplnit do katalogu pole pro podmínky, které umí složit
   * jen server (předlohy, návrhy z reportu), a jejichž odkaz se od obecné
   * položky liší rozsahem. Bez toho se v otevřené předloze „Neotevřel
   * posledních 5 kampaní" nespáruje pole a podmínka vypadá prázdně.
   */
  definition?: unknown;
  /**
   * Kampaň, na kterou je otevřený segment navázaný.
   *
   * PROČ TO KATALOG POTŘEBUJE. Pole se poznává DOSLOVNÝM porovnáním `ref`
   * s `condition.field` (viz komentář nahoře). Obecná položka „Klikl v kampani"
   * má `scope: {}`, kdežto podmínka předvyplněná z reportu má
   * `scope: { campaign_id: … }`, takže se neshodnou a výběr pole zůstane
   * prázdný. Podmínka se přitom vyhodnotí správně a živý počet sedí, jen
   * uživatel nevidí, co v ní stojí, a je to ta horší polovina předvyplnění:
   * segment, který nejde zkontrolovat.
   *
   * Položky se přidávají jen pro TU JEDNU kampaň, ze které se sem přišlo.
   * Nabídnout je pro všechny kampaně projektu by z výběru pole udělalo seznam
   * o stovkách řádků.
   */
  campaign?: { id: string; name: string };
  /**
   * Řeší projekt oslovení a 5. pád?
   *
   * Vypnuto vyřadí z nabídky pole „Jistota 5. pádu". Podmínka, která na něj
   * odkazuje v UŽ ULOŽENÉM segmentu, se tím nezneplatní: vyhodnocuje ji jádro
   * podle AST a to katalog nezná, takže segment počítá dál a po zapnutí zpátky
   * se pole zase objeví i ve výběru.
   */
  greetingEnabled?: boolean;
};

/** Pole, které existuje jen tam, kde projekt oslovení a 5. pád řeší. */
const GREETING_ONLY_FIELDS = new Set(['vocative_confidence']);

export function buildFieldCatalog(t: Translate, input: CatalogInput = {}): FieldDefinition[] {
  const fields: FieldDefinition[] = [];
  const greetingEnabled = input.greetingEnabled ?? true;

  for (const key of CONTACT_FIELD_KEYS) {
    if (!greetingEnabled && GREETING_ONLY_FIELDS.has(key)) continue;
    const fieldClass = contactFieldClass(key);
    // Časy patří do vlastní sekce, ne mezi údaje o člověku: uživatel je hledá
    // podle toho, co znamenají, ne podle toho, ve kterém sloupci leží.
    const group = fieldClass === 'datetime' ? t('fieldGroups.times') : t('fieldGroups.contact');
    fields.push({
      id: `contact.${key}`,
      label: t(`fields.${key}`),
      group,
      ref: { kind: 'contact', key },
      valueType: VALUE_TYPE_BY_CLASS[fieldClass] ?? 'text',
      ...contactEnumOptions(key, t),
      operators: operatorsFor(fieldClass, t),
    });
  }

  for (const attribute of input.attributes ?? []) {
    fields.push({
      id: `attribute.${attribute.key}`,
      label: attribute.label,
      group: t('fieldGroups.attribute'),
      ref: { kind: 'attribute', key: attribute.key },
      valueType: VALUE_TYPE_BY_CLASS[attribute.fieldClass] ?? 'text',
      operators: operatorsFor(attribute.fieldClass, t),
    });
  }

  fields.push({
    id: 'tag',
    label: t('fields.tag'),
    group: t('fieldGroups.tag'),
    ref: { kind: 'tag' },
    valueType: 'enum',
    options: (input.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
    operators: operatorsFor('tag', t),
  });

  for (const list of input.lists ?? []) {
    fields.push({
      id: `list.${list.id}`,
      label: list.name,
      group: t('fieldGroups.list'),
      ref: { kind: 'list', list_id: list.id },
      valueType: 'enum',
      operators: operatorsFor('list', t),
    });
  }

  for (const purpose of CONSENT_PURPOSES) {
    fields.push({
      id: `consent.${purpose}`,
      // Dřív se do popisku psal syrový klíč, takže ve výběru stálo
      // „email_marketing" mezi českými názvy ostatních polí.
      label: t(`consentPurposes.${purpose}`),
      group: t('fieldGroups.consent'),
      ref: { kind: 'consent', purpose },
      valueType: 'enum',
      operators: operatorsFor('consent', t),
    });
  }

  fields.push({
    id: 'suppression',
    label: t('fields.suppression'),
    group: t('fieldGroups.suppression'),
    ref: { kind: 'suppression' },
    valueType: 'enum',
    operators: operatorsFor('suppression', t),
  });

  for (const metric of ENGAGEMENT_METRICS) {
    fields.push({
      id: `engagement.${metric}`,
      label: t(`fields.engagement.${metric}`),
      group: t('fieldGroups.engagement'),
      ref: { kind: 'engagement', metric, scope: {} },
      valueType: 'number',
      operators: operatorsFor('engagement', t),
    });
  }

  // Tytéž metriky, ale omezené na jednu kampaň. Viz `CatalogInput.campaign`.
  if (input.campaign !== undefined) {
    const campaign = input.campaign;
    for (const metric of ENGAGEMENT_METRICS) {
      fields.push({
        id: `engagement.${metric}.campaign.${campaign.id}`,
        label: t(`fields.engagementInCampaign.${metric}`, { campaign: campaign.name }),
        group: t('fieldGroups.engagement'),
        ref: { kind: 'engagement', metric, scope: { campaign_id: campaign.id } },
        valueType: 'number',
        operators: operatorsFor('engagement', t),
      });
    }
  }

  for (const segment of input.segments ?? []) {
    fields.push({
      id: `segment.${segment.id}`,
      label: segment.name,
      group: t('fieldGroups.segment'),
      ref: { kind: 'segment', segment_id: segment.id },
      valueType: 'enum',
      operators: operatorsFor('segment', t),
    });
  }

  fields.push(...scopedEngagementFields(fields, input.definition, t));

  return fields;
}

type EngagementScope = {
  campaign_id?: string;
  since_days?: number;
  last_n_campaigns?: number;
};

/** Věta „ale jen v tomhle rozsahu", kterou obecná položka katalogu nenese. */
function scopeSuffix(scope: EngagementScope, t: Translate): string | null {
  if (scope.last_n_campaigns !== undefined) {
    return t('fieldScopes.lastCampaigns', { count: scope.last_n_campaigns });
  }
  if (scope.since_days !== undefined) {
    return t('fieldScopes.sinceDays', { days: scope.since_days });
  }
  if (scope.campaign_id !== undefined) return t('fieldScopes.oneCampaign');
  return null;
}

/**
 * Pole pro podmínky s OMEZENÝM rozsahem aktivity.
 *
 * Stavitel neumí rozsah zadat, takže takové podmínky přicházejí jen hotové:
 * z předloh (`Neotevřel posledních 5 kampaní` má `scope.last_n_campaigns = 5`)
 * a z reportu kampaně. Katalog přitom nese jen položku s prázdným rozsahem,
 * takže se odkaz nespároval a předloha se otevřela s prázdným výběrem pole.
 * Podmínka se počítala správně, jen ji nešlo zkontrolovat, což je u segmentu,
 * podle kterého se rozhoduje o odeslání kampaně, ta horší polovina.
 *
 * Doplňuje se jen to, co v katalogu ještě není, a jen z definice, která se
 * právě otevírá. Nabízet všechny myslitelné rozsahy by z výběru pole udělalo
 * nekonečný seznam.
 */
function scopedEngagementFields(
  existing: FieldDefinition[],
  definition: unknown,
  t: Translate,
): FieldDefinition[] {
  if (definition === undefined || definition === null) return [];
  const known = new Set(existing.map((field) => fieldRefKey(field.ref)));
  const added: FieldDefinition[] = [];

  const visit = (node: unknown): void => {
    const typed = node as { type?: string; children?: unknown[]; field?: unknown };
    if (typed.type === 'group') {
      for (const child of typed.children ?? []) visit(child);
      return;
    }
    const ref = typed.field as
      { kind?: string; metric?: string; scope?: EngagementScope } | undefined;
    if (ref?.kind !== 'engagement' || ref.metric === undefined) return;
    const key = fieldRefKey(ref);
    if (known.has(key)) return;
    const suffix = scopeSuffix(ref.scope ?? {}, t);
    if (suffix === null) return;
    known.add(key);
    added.push({
      id: `engagement.${ref.metric}.scope.${added.length}`,
      label: `${t(`fields.engagement.${ref.metric}`)} ${suffix}`,
      group: t('fieldGroups.engagement'),
      ref: { kind: 'engagement', metric: ref.metric, scope: { ...ref.scope } },
      valueType: 'number',
      operators: operatorsFor('engagement', t),
    });
  };

  visit((definition as { root?: unknown }).root);
  return added;
}
