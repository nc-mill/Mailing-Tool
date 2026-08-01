'use client';

import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import {
  MAX_DEPTH,
  type ConditionNode,
  type FieldDefinition,
  type FieldValueType,
  type GroupNode,
  type NodePath,
  type OperatorDefinition,
  type ScalarValue,
  type SegmentAst,
} from './types';
import { useQueryBuilder } from './use-query-builder';

export type QueryBuilderLabels = {
  addRule: string;
  addGroup: string;
  removeRule: string;
  removeGroup: string;
  chooseField: string;
  chooseOperator: string;
  value: string;
  /** Popisky obou polí u tvaru `range`. */
  valueFrom: string;
  valueTo: string;
  /** Žetonový vstup u tvaru `list`. */
  valueList: string;
  addValue: string;
  removeValue: (item: string) => string;
  listLimit: (max: number) => string;
  rangeOrder: string;
  showJson: string;
  depthLimit: string;
  childLimit: string;
  negationHint: string;
  notNullHint: string;
  addEmptyCondition: string;
  all: string;
  atLeastOne: string;
  is: string;
  isNot: string;
};

export type GroupSentenceSlots = { polarity: React.ReactNode; quantifier: React.ReactNode };

const CONTROL =
  'min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm text-text';

function inputTypeOf(valueType: FieldValueType): 'text' | 'number' | 'date' | 'datetime-local' {
  if (valueType === 'number') return 'number';
  if (valueType === 'date') return 'date';
  if (valueType === 'datetime') return 'datetime-local';
  return 'text';
}

/** Číselné pole musí do AST uložit číslo, ne řetězec. Prázdno je `null`. */
function parseScalar(raw: string, valueType: FieldValueType): ScalarValue {
  if (raw === '') return null;
  if (valueType === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return raw;
}

/**
 * Žetonový vstup pro tvar `list`. Je to samostatná komponenta, protože si
 * drží rozepsanou položku, a definovat ji uvnitř `QueryBuilder` by ji při
 * každém překreslení odpojilo a smazalo rozepsaný text.
 */
function ValueList({
  values,
  labels,
  maxItems,
  onChange,
}: {
  values: ScalarValue[];
  labels: QueryBuilderLabels;
  maxItems: number;
  onChange: (next: ScalarValue[]) => void;
}) {
  const [pending, setPending] = useState('');
  const full = values.length >= maxItems;

  function commit() {
    const trimmed = pending.trim();
    if (trimmed === '' || full) return;
    onChange([...values, trimmed]);
    setPending('');
  }

  return (
    <div data-testid="condition-value-list" className="flex flex-wrap items-center gap-2">
      <ul className="flex flex-wrap items-center gap-1">
        {values.map((item, index) => (
          <li
            key={`${String(item)}-${index}`}
            className="flex items-center gap-1 rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-sm text-text"
          >
            {String(item)}
            <button
              type="button"
              aria-label={labels.removeValue(String(item))}
              onClick={() => onChange(values.filter((_, position) => position !== index))}
              className="flex size-5 items-center justify-center text-text-muted"
            >
              <X aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>

      {full ? (
        <p className="text-sm text-text-muted">{labels.listLimit(maxItems)}</p>
      ) : (
        <>
          <input
            aria-label={labels.valueList}
            value={pending}
            onChange={(event) => setPending(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter přidá žeton a nesmí odeslat formulář obrazovky.
              event.preventDefault();
              commit();
            }}
            className={CONTROL}
          />
          <Button variant="secondary" onClick={commit}>
            {labels.addValue}
          </Button>
        </>
      )}
    </div>
  );
}

/** Výchozí věta: jen oba prvky vedle sebe, žádná vlastní prozaická vsuvka. */
function defaultGroupSentence(slots: GroupSentenceSlots): React.ReactNode {
  return (
    <>
      {slots.polarity} {slots.quantifier}
    </>
  );
}

export function QueryBuilder({
  fields,
  value,
  onChange,
  labels,
  renderGroupSentence = defaultGroupSentence,
  showJsonToggle = false,
  footer,
  className,
}: {
  fields: FieldDefinition[];
  /** AST podle části 2, 4.11.1. Komponenta je řízená (rozhodnutí R12). */
  value: SegmentAst;
  onChange: (next: SegmentAst) => void;
  labels: QueryBuilderLabels;
  /**
   * Věta skupiny je **jedna ICU zpráva s pojmenovanými sloty** (kritérium 71b).
   * Pořadí ovládacích prvků tedy určuje překlad, ne komponenta.
   */
  renderGroupSentence?: (slots: GroupSentenceSlots) => React.ReactNode;
  showJsonToggle?: boolean;
  /** Patička s počtem a vzorkem kontaktů, dodává ji obrazovka segmentu. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const builder = useQueryBuilder({ value, onChange });
  const [showJson, setShowJson] = useState(false);

  const fieldGroups = [...new Set(fields.map((item) => item.group))];

  /** Pole se v AST poznává podle `field`, ne podle `id`, které v AST není. */
  function fieldOf(condition: ConditionNode): FieldDefinition | undefined {
    return fields.find((item) => JSON.stringify(item.ref) === JSON.stringify(condition.field));
  }

  /**
   * Vykreslení hodnoty se řídí **tvarem operátoru**, ne tím, jestli je
   * operátor vybraný. Bez toho by šestnáct operátorů bez hodnoty nabídlo
   * pole, které server odmítne, a šest seznamových a rozsahových by nešlo
   * zadat vůbec.
   */
  function renderValue(
    condition: ConditionNode,
    path: NodePath,
    field: FieldDefinition,
    operator: OperatorDefinition,
  ): React.ReactNode {
    const values = Array.isArray(condition.values) ? condition.values : [];

    switch (operator.shape) {
      case 'none':
        return null;

      case 'list':
        return (
          <ValueList
            values={values}
            labels={labels}
            maxItems={operator.maxItems ?? 1000}
            onChange={(next) => builder.setValue(path, { values: next })}
          />
        );

      case 'range': {
        const from = values[0] ?? null;
        const to = values[1] ?? null;
        const type = inputTypeOf(field.valueType);
        const outOfOrder = from !== null && to !== null && String(from) > String(to);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="condition-value"
              aria-label={labels.valueFrom}
              type={type}
              value={from === null ? '' : String(from)}
              onChange={(event) =>
                builder.setValue(path, {
                  values: [parseScalar(event.target.value, field.valueType), to],
                })
              }
              className={CONTROL}
            />
            <input
              data-testid="condition-value"
              aria-label={labels.valueTo}
              type={type}
              value={to === null ? '' : String(to)}
              onChange={(event) =>
                builder.setValue(path, {
                  values: [from, parseScalar(event.target.value, field.valueType)],
                })
              }
              className={CONTROL}
            />
            {outOfOrder ? (
              <p role="alert" className="text-sm text-danger-text">
                {labels.rangeOrder}
              </p>
            ) : null}
          </div>
        );
      }

      case 'integer':
        return (
          <input
            data-testid="condition-value"
            aria-label={labels.value}
            type="number"
            min={operator.min}
            max={operator.max}
            value={
              condition.value === null || condition.value === undefined
                ? ''
                : String(condition.value)
            }
            onChange={(event) =>
              builder.setValue(path, { value: parseScalar(event.target.value, 'number') })
            }
            className={CONTROL}
          />
        );

      default:
        return field.valueType === 'enum' && field.options ? (
          <select
            data-testid="condition-value"
            aria-label={labels.value}
            value={
              condition.value === null || condition.value === undefined
                ? ''
                : String(condition.value)
            }
            onChange={(event) => builder.setValue(path, { value: event.target.value || null })}
            className={CONTROL}
          >
            <option value="">{labels.value}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid="condition-value"
            aria-label={labels.value}
            type={inputTypeOf(field.valueType)}
            value={
              condition.value === null || condition.value === undefined
                ? ''
                : String(condition.value)
            }
            onChange={(event) =>
              builder.setValue(path, { value: parseScalar(event.target.value, field.valueType) })
            }
            className={CONTROL}
          />
        );
    }
  }

  function renderCondition(
    condition: ConditionNode,
    path: NodePath,
    parentPath: NodePath,
  ): React.ReactNode {
    const field = fieldOf(condition);
    const operator = field?.operators.find((item) => item.id === condition.operator);

    return (
      <div
        key={path.join('.')}
        data-testid="condition-row"
        className="flex flex-wrap items-center gap-2 py-1"
      >
        <select
          aria-label={labels.chooseField}
          value={field?.id ?? ''}
          onChange={(event) => {
            const next = fields.find((item) => item.id === event.target.value);
            if (next) builder.setField(path, next);
          }}
          className={CONTROL}
        >
          <option value="">{labels.chooseField}</option>
          {fieldGroups.map((group) => (
            <optgroup key={group} label={group}>
              {fields
                .filter((item) => item.group === group)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        {field ? (
          <select
            data-testid="operator-select"
            aria-label={labels.chooseOperator}
            value={condition.operator}
            onChange={(event) => {
              const next = field.operators.find((item) => item.id === event.target.value);
              if (next) builder.setOperator(path, next);
            }}
            className={CONTROL}
          >
            <option value="">{labels.chooseOperator}</option>
            {field.operators.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}

        {field && operator ? renderValue(condition, path, field, operator) : null}

        <button
          type="button"
          aria-label={labels.removeRule}
          onClick={() => builder.remove(path)}
          className="flex size-11 items-center justify-center rounded-[var(--radius-control)] text-text-muted"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>

        {operator?.negating ? (
          <div className="flex w-full items-center gap-2 pl-1 text-sm text-text-muted">
            <span>{labels.notNullHint}</span>
            <Button variant="link" onClick={() => builder.addCondition(parentPath)}>
              {labels.addEmptyCondition}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroup(group: GroupNode, path: NodePath): React.ReactNode {
    const depth = path.length;
    const negated = group.not === true;

    const polarity = (
      <select
        key="polarity"
        data-slot="polarity"
        aria-label={negated ? labels.isNot : labels.is}
        value={negated ? 'not' : 'is'}
        onChange={(event) => {
          if ((event.target.value === 'not') !== negated) builder.toggleNot(path);
        }}
        className={CONTROL}
      >
        <option value="is">{labels.is}</option>
        <option value="not">{labels.isNot}</option>
      </select>
    );

    const quantifier = (
      <select
        key="quantifier"
        data-slot="quantifier"
        aria-label={group.op === 'and' ? labels.all : labels.atLeastOne}
        value={group.op}
        onChange={(event) => builder.setOp(path, event.target.value as 'and' | 'or')}
        className={CONTROL}
      >
        <option value="and">{labels.all}</option>
        <option value="or">{labels.atLeastOne}</option>
      </select>
    );

    return (
      <fieldset
        key={path.join('.') || 'root'}
        className={cn(
          'rounded-[var(--radius-surface)] border border-border p-4',
          depth > 0 ? 'mt-2 bg-surface-muted' : 'bg-surface',
        )}
      >
        <legend className="flex flex-wrap items-center gap-2 text-sm text-text">
          {renderGroupSentence({ polarity, quantifier })}
        </legend>

        {negated ? <p className="mt-1 text-sm text-text-muted">{labels.negationHint}</p> : null}

        <div className="mt-2">
          {group.children.map((child, index) =>
            child.type === 'condition'
              ? renderCondition(child, [...path, index], path)
              : renderGroup(child, [...path, index]),
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {builder.canAddRule(path) ? (
            <Button variant="secondary" onClick={() => builder.addCondition(path)}>
              {labels.addRule}
            </Button>
          ) : (
            <p className="text-sm text-text-muted">{labels.childLimit}</p>
          )}

          {/* Při dosažení hloubky se tlačítko schová a vysvětlí se proč.
              Chybová hláška by tvrdila, že uživatel udělal něco špatně. */}
          {builder.canAddGroup(path) ? (
            <Button variant="secondary" onClick={() => builder.addGroup(path)}>
              {labels.addGroup}
            </Button>
          ) : depth >= MAX_DEPTH - 1 ? (
            <p className="text-sm text-text-muted">{labels.depthLimit}</p>
          ) : null}

          {depth > 0 ? (
            <Button variant="secondary" onClick={() => builder.remove(path)}>
              {labels.removeGroup}
            </Button>
          ) : null}
        </div>
      </fieldset>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {renderGroup(builder.root, [])}
      {footer}
      {showJsonToggle ? (
        <div>
          <Button variant="link" onClick={() => setShowJson((current) => !current)}>
            {labels.showJson}
          </Button>
          {showJson ? (
            <pre
              role="code"
              className="mt-2 overflow-auto rounded-[var(--radius-control)] bg-surface-muted p-3 font-mono text-xs text-text"
            >
              {builder.json}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
