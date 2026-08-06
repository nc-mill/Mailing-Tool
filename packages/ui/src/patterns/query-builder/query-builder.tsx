'use client';

import { Plus, SquarePlus, Trash2, X } from '../../icons';
import { useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import { fieldRefKey } from './ref-key';
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
  /** Hodnota, kterou už nabídka nezná, typicky smazaný štítek nebo seznam. */
  unknownValue: (value: string) => string;
  /** Pole se vybírá z nabídky, jenže nabídka je prázdná. */
  noOptions: string;
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

/**
 * Ovládací prvek podmínky. Vypadá jako formulářové pole, protože jím je:
 * výška 44 px, vnitřní okraj 10/14, rámeček `border-strong`, plocha `field`
 * a text 15 px. Stejné hodnoty má `Input` i `Select`, aby řádek podmínky
 * nevypadal jako jiný druh formuláře než zbytek aplikace.
 */
const CONTROL =
  'min-h-[var(--size-target-min)] rounded-[var(--radius-control)] border border-border-strong bg-field px-3.5 py-2.5 text-ui text-text';

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
 *
 * DVA REŽIMY, a rozhoduje o nich `options`.
 *
 * Bez nabídky je to volný text (vlastní pole, e-maily). S nabídkou je to VÝBĚR
 * a volný text by byl vyloženě škodlivý: štítek se v podmínce ukládá jako
 * identifikátor, takže napsané „Newsletter" doputovalo až do `WHERE tag_id IN
 * ($2)` a Postgres ho odmítl s `invalid input syntax for type uuid`. Uživatel
 * dostal pětistovku a hlášku „Počet se nepodařilo spočítat.", ze které se nedá
 * poznat, co udělal špatně, protože neudělal nic špatně.
 *
 * Ukládá se `option.value`, zobrazuje se `option.label`. Hodnota, kterou
 * nabídka nezná (mezitím smazaný štítek), se PŘIZNÁ textem, neukazuje se
 * syrové uuid.
 */
function ValueList({
  values,
  labels,
  maxItems,
  options,
  onChange,
}: {
  values: ScalarValue[];
  labels: QueryBuilderLabels;
  maxItems: number;
  options?: Array<{ value: string; label: string }> | undefined;
  onChange: (next: ScalarValue[]) => void;
}) {
  const [pending, setPending] = useState('');
  const full = values.length >= maxItems;
  const picking = options !== undefined;
  const labelOf = (item: ScalarValue): string => {
    const found = options?.find((option) => option.value === String(item));
    return found === undefined
      ? picking
        ? labels.unknownValue(String(item))
        : String(item)
      : found.label;
  };
  const remaining = (options ?? []).filter(
    (option) => !values.some((item) => String(item) === option.value),
  );

  function commit() {
    const trimmed = pending.trim();
    if (trimmed === '' || full) return;
    onChange([...values, trimmed]);
    setPending('');
  }

  return (
    <div
      data-testid="condition-value-list"
      className="flex flex-wrap items-center gap-[var(--spacing-inline)]"
    >
      <ul className="flex flex-wrap items-center gap-[var(--spacing-hairline)]">
        {values.map((item, index) => (
          <li
            key={`${String(item)}-${index}`}
            // Vybraná hodnota je ŠTÍTEK, tedy žlutá plocha. Na tlumené ploše
            // skupiny by se tlumený štítek ztratil a vypadal by jako text.
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent-surface px-2 py-1 text-sm text-text"
          >
            {labelOf(item)}
            <button
              type="button"
              aria-label={labels.removeValue(labelOf(item))}
              onClick={() => onChange(values.filter((_, position) => position !== index))}
              className="flex size-[var(--size-icon-lg)] items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-danger-text"
            >
              <X aria-hidden className="icon-xs" />
            </button>
          </li>
        ))}
      </ul>

      {full ? (
        <p className="text-sm text-text-muted">{labels.listLimit(maxItems)}</p>
      ) : picking ? (
        // Prázdná nabídka se NEUTAJÍ. Ovládací prvek, ze kterého nejde nic
        // vybrat, vypadá jako porucha; věta říká, že vybírat není z čeho.
        remaining.length === 0 ? (
          <p className="text-sm text-text-muted">{labels.noOptions}</p>
        ) : (
          <select
            data-testid="condition-value-option"
            aria-label={labels.valueList}
            value=""
            onChange={(event) => {
              if (event.target.value === '') return;
              onChange([...values, event.target.value]);
            }}
            className={CONTROL}
          >
            <option value="">{labels.addValue}</option>
            {remaining.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
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
          <Button variant="secondary" size="sm" onClick={commit}>
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

  /**
   * Pole se v AST poznává podle `field`, ne podle `id`, které v AST není.
   * Porovnává se KANONICKÝ otisk, protože z databáze se odkaz vrací
   * s přerovnanými klíči, viz `fieldRefKey`.
   */
  function fieldOf(condition: ConditionNode): FieldDefinition | undefined {
    const key = fieldRefKey(condition.field);
    return fields.find((item) => fieldRefKey(item.ref) === key);
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
            {...(field.options === undefined ? {} : { options: field.options })}
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
        className="flex flex-wrap items-center gap-3"
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

        {/* Odebrání podmínky je tiché tlačítko, které se ohlásí až při najetí,
            a to červeně. Trvale červený koš v každém řádku by z rozhraní udělal
            výstražnou plochu. */}
        <button
          type="button"
          aria-label={labels.removeRule}
          onClick={() => builder.remove(path)}
          className="flex size-[var(--size-control)] items-center justify-center rounded-[var(--radius-control)] border border-transparent text-text-muted hover:border-danger hover:text-danger-text"
        >
          <Trash2 aria-hidden className="icon-sm" />
        </button>

        {operator?.negating ? (
          <div className="flex w-full items-center gap-[var(--spacing-inline)] text-sm text-text-muted">
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
      /*
       * VĚTA SKUPINY JE `legend` UVNITŘ `fieldset`, a zůstane jí.
       *
       * Je to sémantická dvojice: díky ní čtečka u každé podmínky přečte, do
       * které skupiny patří, a u vnořených skupin je to jediný kontext, který
       * uživatel má. Návrh kreslí větu NAD tlumeným boxem, ne v něm, takže
       * `fieldset` obaluje víc než ten box: sám nemá rámeček ani plochu,
       * legenda stojí nahoře a box je jeho vnitřní prvek.
       */
      <fieldset
        key={path.join('.') || 'root'}
        className={cn('min-w-0 border-0 p-0', depth > 0 ? 'mt-3' : undefined)}
      >
        <legend className="mb-[var(--spacing-gutter)] flex flex-wrap items-center gap-3 text-meta text-text">
          {renderGroupSentence({ polarity, quantifier })}
        </legend>

        {negated ? (
          <p className="mb-[var(--spacing-inline)] text-sm text-text-muted">
            {labels.negationHint}
          </p>
        ) : null}

        <div
          className={cn(
            'grid gap-3 rounded-[var(--radius-surface)] border border-border p-[var(--spacing-gutter)]',
            // Vnořená skupina se odliší OBRÁCENÍM plochy, ne dalším odstínem:
            // systém má dvě plochy papíru a třetí by si musel vymyslet.
            depth > 0 ? 'bg-surface' : 'bg-surface-muted',
          )}
        >
          {group.children.map((child, index) =>
            child.type === 'condition'
              ? renderCondition(child, [...path, index], path)
              : renderGroup(child, [...path, index]),
          )}

          <div className="flex flex-wrap items-center gap-[var(--spacing-inline)] pt-[var(--spacing-hairline)]">
            {builder.canAddRule(path) ? (
              <Button variant="secondary" size="sm" onClick={() => builder.addCondition(path)}>
                <Plus aria-hidden className="icon-sm" />
                {labels.addRule}
              </Button>
            ) : (
              <p className="text-sm text-text-muted">{labels.childLimit}</p>
            )}

            {/* Při dosažení hloubky se tlačítko schová a vysvětlí se proč.
                Chybová hláška by tvrdila, že uživatel udělal něco špatně. */}
            {builder.canAddGroup(path) ? (
              <Button variant="secondary" size="sm" onClick={() => builder.addGroup(path)}>
                <SquarePlus aria-hidden className="icon-sm" />
                {labels.addGroup}
              </Button>
            ) : depth >= MAX_DEPTH - 1 ? (
              <p className="text-sm text-text-muted">{labels.depthLimit}</p>
            ) : null}

            {depth > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => builder.remove(path)}>
                {labels.removeGroup}
              </Button>
            ) : null}
          </div>
        </div>
      </fieldset>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-[var(--spacing-gutter)]', className)}>
      {renderGroup(builder.root, [])}
      {footer}
      {showJsonToggle ? (
        <div className="flex flex-col items-start gap-[var(--spacing-inline)]">
          <Button
            variant="link"
            className="text-sm"
            onClick={() => setShowJson((current) => !current)}
          >
            {labels.showJson}
          </Button>
          {showJson ? (
            <pre
              role="code"
              className="w-full overflow-auto rounded-[var(--radius-control)] border border-border bg-surface-muted p-[var(--spacing-stack)] font-mono text-meta text-text"
            >
              {builder.json}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
