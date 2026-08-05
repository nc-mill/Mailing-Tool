import type { Node, SegmentAst } from './ast';

/**
 * Které segmenty může změnit AKTIVITA jednoho kontaktu.
 *
 * Webová událost mění v databázi přesně dvě věci (část 5, 3.9.3, kroky 3 a 6):
 * řádek ve `web_events` a `contacts.last_activity_at`. Nic jiného. Segment,
 * jehož definice ani jedno z toho nečte, se po události nemůže změnit, takže
 * jeho `cached_count` je pořád stejně platné jako minutu předtím.
 *
 * Proč to není detail: projekt může mít podle limitů stovky segmentů a přepočet
 * jednoho segmentu nad 5 miliony kontaktů stojí 2 až 6 sekund (část 2, 4.11.6).
 * Bez tohohle filtru by jedna návštěva stránky zařadila přepočet i u segmentu
 * „stav je aktivní", který s webovou událostí nemá nic společného.
 *
 * `engagement.*` se ZÁMĚRNĚ nepočítá mezi závislé pole: metriky odeslání,
 * otevření a kliků plní doména trackingu z `message_events`, ne webová událost.
 * Jejich přepočet patří k `tracking.process_engagement`, ne sem.
 */

export type SegmentDefinitionRow = { id: string; definition: unknown };

/**
 * Vrátí true, když uzel čte web_events nebo last_activity_at. Odkazy na jiné
 * segmenty se cestou sbírají do `refs`, protože jejich závislost se dá vyhodnotit
 * teprve nad celou množinou segmentů projektu.
 */
function scan(node: Node, refs: Set<string>): boolean {
  if (node.type === 'group') {
    let hit = false;
    // ŽÁDNÝ early return: i po nálezu se musí projít zbytek stromu, jinak by
    // se nesebraly odkazy na segmenty z ostatních větví a šíření závislosti
    // níž by pracovalo s neúplným grafem.
    for (const child of node.children) if (scan(child, refs)) hit = true;
    return hit;
  }
  const field = node.field;
  if (field.kind === 'event') return true;
  if (field.kind === 'contact' && field.key === 'last_activity_at') return true;
  if (field.kind === 'segment') refs.add(field.segment_id);
  return false;
}

function isNode(value: unknown): value is Node {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'group' || type === 'condition';
}

function rootOf(definition: unknown): Node | null {
  if (typeof definition !== 'object' || definition === null) return null;
  const root = (definition as { root?: unknown }).root;
  return isNode(root) ? root : null;
}

/**
 * Množina segmentů, jejichž počet může změnit aktivita kontaktu.
 *
 * Vstupem je CELÁ množina dynamických segmentů projektu, ne jen kandidáti:
 * segment, který sám žádné chování nečte, ale odkazuje na segment, který ho
 * čte, je závislý taky. Šíření běží do pevného bodu. Hloubka vnoření je podle
 * části 2, 4.11.4 omezená na 2 a cykly jsou zakázané při zápisu, takže smyčka
 * doběhne po dvou průchodech; psát ji jako fixní bod je i tak bezpečnější, než
 * spoléhat na limit, který vlastní jiný modul.
 *
 * Definice, kterou se nepodaří přečíst, se počítá jako ZÁVISLÁ. Vzniknout
 * nemůže, protože se AST validuje při zápisu, ale kdyby se to stalo, je lepší
 * jeden přepočet navíc než segment, který se tiše přestane aktualizovat.
 */
export function activityDependentSegmentIds(rows: readonly SegmentDefinitionRow[]): Set<string> {
  const dependent = new Set<string>();
  const refsOf = new Map<string, Set<string>>();

  for (const row of rows) {
    const refs = new Set<string>();
    const root = rootOf(row.definition);
    if (root === null || scan(root, refs)) dependent.add(row.id);
    refsOf.set(row.id, refs);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, refs] of refsOf) {
      if (dependent.has(id)) continue;
      for (const ref of refs) {
        if (!dependent.has(ref)) continue;
        dependent.add(id);
        changed = true;
        break;
      }
    }
  }
  return dependent;
}

/** Jen pro čitelnost na jednom segmentu, uvnitř volá tutéž analýzu. */
export function isActivityDependent(definition: SegmentAst | unknown): boolean {
  return activityDependentSegmentIds([{ id: 'x', definition }]).has('x');
}
