import {
  MAX_CHILDREN,
  MAX_DEPTH,
  type ConditionNode,
  type FieldDefinition,
  type GroupNode,
  type NodePath,
  type OperatorDefinition,
  type QueryNode,
  type ScalarValue,
} from './types';

/**
 * Čisté operace nad AST. Žádná z nich nemění vstup, všechny vracejí nový
 * strom. Díky tomu je komponenta řízená a `onChange` dostane vždycky
 * výsledek úpravy, ne stav před ní.
 */

export function nodeAt(root: GroupNode, path: NodePath): QueryNode | null {
  let node: QueryNode = root;
  for (const index of path) {
    if (node.type !== 'group') return null;
    const child: QueryNode | undefined = node.children[index];
    if (child === undefined) return null;
    node = child;
  }
  return node;
}

/**
 * Nahradí uzel na cestě výsledkem `transform`. Když `transform` vrátí `null`,
 * uzel se z rodiče odebere.
 */
function mapAt(
  root: GroupNode,
  path: NodePath,
  transform: (node: QueryNode) => QueryNode | null,
): GroupNode {
  if (path.length === 0) {
    const next = transform(root);
    return next !== null && next.type === 'group' ? next : root;
  }

  const head = path[0];
  if (head === undefined) return root;
  const rest = path.slice(1);
  const child = root.children[head];
  if (child === undefined) return root;

  let nextChild: QueryNode | null;
  if (rest.length === 0) {
    nextChild = transform(child);
  } else if (child.type === 'group') {
    nextChild = mapAt(child, rest, transform);
  } else {
    return root;
  }

  if (nextChild === null) {
    return { ...root, children: root.children.filter((_, index) => index !== head) };
  }

  const replacement = nextChild;
  return {
    ...root,
    children: root.children.map((item, index) => (index === head ? replacement : item)),
  };
}

/** Hloubka uzlu. Kořen je 0. */
export function depthOf(path: NodePath): number {
  return path.length;
}

export function canAddGroup(root: GroupNode, path: NodePath): boolean {
  const node = nodeAt(root, path);
  if (node === null || node.type !== 'group') return false;
  // Povolené úrovně jsou 0 až 4, tedy pět. Skupina na úrovni 4 už další
  // nepřidá, protože potomek by byl šestá úroveň.
  if (path.length >= MAX_DEPTH - 1) return false;
  return node.children.length < MAX_CHILDREN;
}

export function canAddRule(root: GroupNode, path: NodePath): boolean {
  const node = nodeAt(root, path);
  if (node === null || node.type !== 'group') return false;
  return node.children.length < MAX_CHILDREN;
}

export function addCondition(root: GroupNode, path: NodePath): GroupNode {
  if (!canAddRule(root, path)) return root;
  const fresh: ConditionNode = { type: 'condition', field: { kind: 'tag' }, operator: '' };
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, children: [...node.children, fresh] } : node,
  );
}

export function addGroup(root: GroupNode, path: NodePath): GroupNode {
  if (!canAddGroup(root, path)) return root;
  const fresh: GroupNode = { type: 'group', op: 'and', not: false, children: [] };
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, children: [...node.children, fresh] } : node,
  );
}

export function removeAt(root: GroupNode, path: NodePath): GroupNode {
  if (path.length === 0) return root;
  return mapAt(root, path, () => null);
}

export function toggleNot(root: GroupNode, path: NodePath): GroupNode {
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, not: node.not !== true } : node,
  );
}

export function setOp(root: GroupNode, path: NodePath, op: 'and' | 'or'): GroupNode {
  return mapAt(root, path, (node) => (node.type === 'group' ? { ...node, op } : node));
}

/**
 * Změna pole mění množinu povolených operátorů, takže operátor i hodnota
 * se vynulují. Ponechaná hodnota by dala neplatný dotaz.
 */
export function setField(root: GroupNode, path: NodePath, field: FieldDefinition): GroupNode {
  return mapAt(root, path, (node) =>
    node.type === 'condition' ? { type: 'condition', field: field.ref, operator: '' } : node,
  );
}

/**
 * Nastaví operátor a **přesně podle jeho tvaru** připraví místa na hodnoty.
 * U tvaru `none` se `value` i `values` z uzlu odstraní, protože jejich
 * přítomnost je podle 4.11.2 chyba.
 */
export function setOperator(
  root: GroupNode,
  path: NodePath,
  operator: OperatorDefinition,
): GroupNode {
  return mapAt(root, path, (node) => {
    if (node.type !== 'condition') return node;
    const base = { type: 'condition' as const, field: node.field, operator: operator.id };
    switch (operator.shape) {
      case 'none':
        return base;
      case 'list':
        return { ...base, values: Array.isArray(node.values) ? node.values : [] };
      case 'range':
        return { ...base, values: [null, null] };
      default:
        return { ...base, value: null };
    }
  });
}

export function setValue(
  root: GroupNode,
  path: NodePath,
  patch: { value?: ScalarValue } | { values?: ScalarValue[] },
): GroupNode {
  return mapAt(root, path, (node) => (node.type === 'condition' ? { ...node, ...patch } : node));
}
