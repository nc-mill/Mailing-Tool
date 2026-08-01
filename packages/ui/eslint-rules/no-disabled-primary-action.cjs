'use strict';

/**
 * Vynucuje princip P5 a kritérium 18: primární ani destruktivní akce
 * nesmí být mrtvá. Místo `disabled` se použije `unavailableReason`,
 * které tlačítko nechá funkční a vysvětlí, proč akci teď neprovede.
 *
 * Výjimka se zapisuje atributem `data-allow-disabled="<důvod>"`
 * a musí být zároveň v allowlist.json, jinak ji hlídá test v úkolu 34.
 */
const LOUD_VARIANTS = new Set(['primary', 'destructive']);
const LOUD_CLASSES = ['bg-primary', 'bg-danger'];

function attributeNamed(node, name) {
  return node.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === name,
  );
}

function literalValue(attribute) {
  if (!attribute || !attribute.value) return undefined;
  if (attribute.value.type === 'Literal') return attribute.value.value;
  return undefined;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Primární a destruktivní tlačítko nesmí být disabled. Použij unavailableReason.',
    },
    messages: {
      noDisabledPrimary:
        'Primární ani destruktivní akce nesmí být disabled (princip P5, kritérium 18). Použij unavailableReason a vysvětli, proč akce nejde provést.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const disabled = attributeNamed(node, 'disabled');
        if (!disabled) return;
        if (attributeNamed(node, 'data-allow-disabled')) return;

        const variant = literalValue(attributeNamed(node, 'variant'));
        const className = literalValue(attributeNamed(node, 'className')) || '';
        const isLoud =
          (typeof variant === 'string' && LOUD_VARIANTS.has(variant)) ||
          LOUD_CLASSES.some((token) => String(className).includes(token));

        if (isLoud) {
          context.report({ node: disabled, messageId: 'noDisabledPrimary' });
        }
      },
    };
  },
};
