/**
 * AST segmentu **doslova podle části 2, kapitola 4.11.1** (rozhodnutí R11).
 * Tenhle strom se ukládá do `segments.definition` a validuje ho `SegmentAstV1`,
 * takže se tady nesmí lišit ani o jedno pole. Uzly nemají `id`: adresují se
 * cestou, tedy polem indexů potomků od kořene.
 */
export type Combinator = 'and' | 'or';

export type ScalarValue = string | number | boolean | null;

export type FieldRef =
  | { kind: 'contact'; key: string }
  | { kind: 'attribute'; key: string }
  | { kind: 'tag' }
  | { kind: 'list'; list_id: string }
  | { kind: 'consent'; purpose: string }
  | { kind: 'suppression' }
  | { kind: 'engagement'; metric: string; scope: Record<string, unknown> }
  | { kind: 'event'; name: string; property?: string }
  | { kind: 'segment' };

export type ConditionNode = {
  type: 'condition';
  field: FieldRef;
  operator: string;
  /** Jen u tvarů `scalar` a `integer`. */
  value?: ScalarValue;
  /** Jen u tvarů `list` a `range`. */
  values?: ScalarValue[];
};

export type GroupNode = {
  type: 'group';
  op: Combinator;
  /** Negace celé skupiny. V rozhraní se nikdy nepíše slovem NOT. */
  not?: boolean;
  children: QueryNode[];
};

export type QueryNode = GroupNode | ConditionNode;

export type SegmentAst = { version: 1; root: GroupNode };

/** Cesta k uzlu: `[]` je kořen, `[0, 2]` třetí potomek prvního potomka kořene. */
export type NodePath = number[];

/**
 * Tvar hodnoty, kterou operátor přijímá. Vychází z tabulky typové
 * kompatibility v části 2, kapitola 4.11.2.
 */
export type OperatorValueShape = 'none' | 'scalar' | 'list' | 'range' | 'integer';

/** Typ hodnoty pole. Určuje, jaký ovládací prvek se pro hodnotu vykreslí. */
export type FieldValueType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum';

export type OperatorDefinition = {
  id: string;
  label: string;
  /** Operátor, po kterém se nabídne doplnění podmínky na prázdnou hodnotu. */
  negating?: boolean;
  shape: OperatorValueShape;
  /** Meze u tvaru `integer`, například 1 až 3650 u `in_last_days`. */
  min?: number;
  max?: number;
  /** Meze počtu položek u tvaru `list`, podle 4.11.2 je to 1 až 1000. */
  minItems?: number;
  maxItems?: number;
};

export type FieldDefinition = {
  /** Stabilní klíč do výběru pole. Není součástí AST. */
  id: string;
  label: string;
  /** Skupina ve výběru pole, například „Údaje kontaktu" nebo „Chování". */
  group: string;
  /** Odkaz na pole, který se zapíše do AST. */
  ref: FieldRef;
  /** Typ hodnoty. Rozhoduje o tom, jestli je vstup text, číslo nebo datum. */
  valueType: FieldValueType;
  /** Nabídka voleb u `valueType: 'enum'`. */
  options?: Array<{ value: string; label: string }>;
  /** Operátory povolené pro tohle pole. Matici jako data vlastní část 2. */
  operators: OperatorDefinition[];
};

export const MAX_DEPTH = 5;
export const MAX_CHILDREN = 50;

/**
 * Rozklad všech 40 operátorů matice 4.11.2 podle tvaru hodnoty.
 *
 * Nepoužívá ho vykreslení, to se řídí `shape` u konkrétního operátoru,
 * který dodá plán segmentů. Je to **kontrolní tabulka**: test v kroku 1
 * na ní ověřuje, že rozklad je úplný a nic se nepřekrývá, takže se nemůže
 * stát, že by se objevil operátor, pro který komponenta nemá co vykreslit.
 */
export const OPERATOR_SHAPES: Record<OperatorValueShape, readonly string[]> = {
  none: [
    'is_empty',
    'is_not_empty',
    'is_true',
    'is_false',
    'is_member',
    'is_not_member',
    'is_confirmed',
    'is_pending',
    'is_unsubscribed',
    'is_granted',
    'is_withdrawn',
    'is_missing',
    'is_suppressed',
    'is_not_suppressed',
    'did',
    'did_not',
  ],
  scalar: [
    'eq',
    'neq',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'gt',
    'gte',
    'lt',
    'lte',
    'on',
    'before',
    'after',
  ],
  list: ['in', 'not_in', 'has_any', 'has_all', 'has_none'],
  range: ['between'],
  integer: ['in_last_days', 'not_in_last_days', 'in_next_days', 'count_gte', 'count_lte'],
};
