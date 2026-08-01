import { CONSENT_PURPOSES, CONTACT_FIELD_KEYS, ENGAGEMENT_METRICS, OPERATORS } from '../ast';

/**
 * JSON Schema verze 1 pro `GET /api/v1/segments/schema`.
 *
 * ODCHYLKA OD PLÁNU: plán tenhle soubor umisťoval do `segments/json-schema.ts`,
 * tedy do kořene modulu. Ten soubor v repozitáři není a kořen modulu vlastní
 * jiná část plánu, takže schéma bydlí tady, v adresáři rout, které ho jako
 * jediné potřebují. Až kořenový soubor vznikne, stačí odsud reexport.
 *
 * Schéma se NEGENERUJE ze zodu. `GroupNodeSchema` je `z.lazy` s ruční typovou
 * anotací, takže `z.toJSONSchema()` z něj rekurzi nevytáhne a vrátí prázdný
 * objekt. Ručně psané schéma je delší, ale odpovídá tomu, co validátor
 * doopravdy přijímá, a je na to test.
 */
export function segmentJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://mlain.dev/schemas/segment-ast-v1.json',
    title: 'SegmentAstV1',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'root'],
    properties: {
      version: { const: 1 },
      root: { $ref: '#/$defs/group' },
    },
    $defs: {
      group: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'op', 'children'],
        properties: {
          type: { const: 'group' },
          op: { enum: ['and', 'or'] },
          not: { type: 'boolean' },
          children: {
            type: 'array',
            items: { oneOf: [{ $ref: '#/$defs/group' }, { $ref: '#/$defs/condition' }] },
          },
        },
      },
      condition: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'field', 'operator'],
        properties: {
          type: { const: 'condition' },
          field: { $ref: '#/$defs/field' },
          operator: { enum: [...OPERATORS] },
          value: {},
          values: { type: 'array' },
        },
      },
      field: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'key'],
            properties: { kind: { const: 'contact' }, key: { enum: [...CONTACT_FIELD_KEYS] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'key'],
            properties: {
              kind: { const: 'attribute' },
              key: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: { kind: { const: 'tag' } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'list_id'],
            properties: { kind: { const: 'list' }, list_id: { type: 'string', format: 'uuid' } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'purpose'],
            properties: { kind: { const: 'consent' }, purpose: { enum: [...CONSENT_PURPOSES] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: { kind: { const: 'suppression' } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'metric'],
            properties: {
              kind: { const: 'engagement' },
              metric: { enum: [...ENGAGEMENT_METRICS] },
              scope: { type: 'object' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name'],
            properties: {
              kind: { const: 'event' },
              name: { type: 'string' },
              scope: { type: 'object' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'segment_id'],
            properties: {
              kind: { const: 'segment' },
              segment_id: { type: 'string', format: 'uuid' },
            },
          },
        ],
      },
    },
  };
}
