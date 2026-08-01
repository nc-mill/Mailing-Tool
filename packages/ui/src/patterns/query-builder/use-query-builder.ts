'use client';

import { useCallback, useMemo } from 'react';
import * as ops from './paths';
import type {
  FieldDefinition,
  GroupNode,
  NodePath,
  OperatorDefinition,
  ScalarValue,
  SegmentAst,
} from './types';

/**
 * Řízený query builder (rozhodnutí R12). Vlastní stav nemá: dostane `value`,
 * spočítá nový strom a ohlásí ho. Tím je vyloučené, aby `onChange` dostal
 * hodnotu z předchozího vykreslení.
 *
 * Hloubka nejvýš 5 a 50 potomků na skupinu. Při dosažení stropu se tlačítko
 * na přidání **schová s vysvětlením**, nezobrazuje se chyba (kritérium 47).
 */
export function useQueryBuilder({
  value,
  onChange,
}: {
  value: SegmentAst;
  onChange: (next: SegmentAst) => void;
}) {
  const root = value.root;

  const emit = useCallback(
    (nextRoot: GroupNode) => {
      if (nextRoot === root) return;
      onChange({ ...value, version: 1, root: nextRoot });
    },
    [onChange, root, value],
  );

  return {
    root,
    json: useMemo(() => JSON.stringify(value, null, 2), [value]),
    nodeAt: useCallback((path: NodePath) => ops.nodeAt(root, path), [root]),
    depthOf: ops.depthOf,
    canAddGroup: useCallback((path: NodePath) => ops.canAddGroup(root, path), [root]),
    canAddRule: useCallback((path: NodePath) => ops.canAddRule(root, path), [root]),
    addCondition: useCallback((path: NodePath) => emit(ops.addCondition(root, path)), [emit, root]),
    addGroup: useCallback((path: NodePath) => emit(ops.addGroup(root, path)), [emit, root]),
    remove: useCallback((path: NodePath) => emit(ops.removeAt(root, path)), [emit, root]),
    toggleNot: useCallback((path: NodePath) => emit(ops.toggleNot(root, path)), [emit, root]),
    setOp: useCallback(
      (path: NodePath, op: 'and' | 'or') => emit(ops.setOp(root, path, op)),
      [emit, root],
    ),
    setField: useCallback(
      (path: NodePath, field: FieldDefinition) => emit(ops.setField(root, path, field)),
      [emit, root],
    ),
    setOperator: useCallback(
      (path: NodePath, operator: OperatorDefinition) => emit(ops.setOperator(root, path, operator)),
      [emit, root],
    ),
    setValue: useCallback(
      (path: NodePath, patch: { value?: ScalarValue } | { values?: ScalarValue[] }) =>
        emit(ops.setValue(root, path, patch)),
      [emit, root],
    ),
  };
}
