import {
  CONSENT_PURPOSES,
  CONTACT_FIELD_KEYS,
  contactFieldClass,
  ENGAGEMENT_METRICS,
  FIELD_CLASS_OPERATORS,
  type FieldClass,
} from './operator-matrix';
import { OPERATOR_SHAPES } from '@mlain/ui/patterns/query-builder';
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

function operatorsFor(fieldClass: FieldClass, t: Translate): OperatorDefinition[] {
  return FIELD_CLASS_OPERATORS[fieldClass].map((operator) => ({
    id: operator,
    label: t(`operators.${operator}`),
    shape: SHAPE_BY_OPERATOR.get(operator) ?? 'scalar',
    ...(isNegating(operator) ? { negating: true } : {}),
  }));
}

export type CatalogInput = {
  attributes?: { key: string; label: string; fieldClass: FieldClass }[];
  lists?: { id: string; name: string }[];
  segments?: { id: string; name: string }[];
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
};

export function buildFieldCatalog(t: Translate, input: CatalogInput = {}): FieldDefinition[] {
  const fields: FieldDefinition[] = [];

  for (const key of CONTACT_FIELD_KEYS) {
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
      label: purpose,
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
      // NÁLEZ PROTI P05: `FieldRef` v `@mlain/ui/patterns/query-builder` má
      // variantu `{ kind: 'segment' }` BEZ `segment_id`, kdežto `SegmentAstV1`
      // v jádru ho vyžaduje. Komponenta by tím vyrobila strom, který server
      // odmítne. Do opravy typu se odkaz doplňuje tady a přetypování je úzké.
      ref: { kind: 'segment', segment_id: segment.id } as unknown as FieldDefinition['ref'],
      valueType: 'enum',
      operators: operatorsFor('segment', t),
    });
  }

  return fields;
}
